use std::{collections::HashMap, sync::Arc};

use alloy_primitives::ChainId;
use eth_rpc::EthRpcClient;
use prover::Prover;
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::error;

use crate::{
    caip::AssetId,
    chain_config::{ChainConfig, get_chain_config},
    railgun::{
        address::RailgunAddress,
        indexer::{NoteSyncer, TransactionSyncer, UtxoIndexer, UtxoIndexerError, UtxoIndexerState},
        merkle_tree::SmartWalletUtxoVerifier,
        note::{Note, utxo::UtxoNote},
        poi::{PoiProvider, PoiProviderError},
        signer::Signer,
        transaction::{ProvedTx, ShieldBuilder, TransactionBuilder, TransactionBuilderError},
    },
};

/// Interfaces with the RAILGUN protocol.
pub struct RailgunProvider {
    chain: ChainConfig,
    utxo_indexer: UtxoIndexer,
    prover: Arc<dyn Prover>,

    poi_provider: Option<PoiProvider>,
}

#[derive(Serialize, Deserialize)]
pub struct RailgunProviderState {
    pub chain_id: ChainId,
    pub indexer: UtxoIndexerState,
}

#[derive(Debug, Error)]
pub enum RailgunProviderError {
    #[error("Unsupported chain ID: {0}")]
    UnsupportedChainId(ChainId),
    #[error("Utxo indexer error: {0}")]
    UtxoIndexer(#[from] UtxoIndexerError),
    #[error("Build error: {0}")]
    Build(#[from] TransactionBuilderError),
    #[error("POI provider error: {0}")]
    PoiProvider(#[from] PoiProviderError),
}

/// General provider functions
impl RailgunProvider {
    pub fn new(
        chain: ChainConfig,
        provider: Arc<dyn EthRpcClient>,
        utxo_syncer: Arc<dyn NoteSyncer>,
        prover: Arc<dyn Prover>,
    ) -> Self {
        let utxo_verifier = Arc::new(SmartWalletUtxoVerifier::new(
            chain.railgun_smart_wallet,
            provider.clone(),
        ));

        Self {
            chain,
            utxo_indexer: UtxoIndexer::new(utxo_syncer, utxo_verifier),
            prover,
            poi_provider: None,
        }
    }

    pub fn with_poi(&mut self, txid_syncer: Arc<dyn TransactionSyncer>) {
        let poi_provider = PoiProvider::new(
            self.chain.id,
            self.chain.poi_endpoint,
            self.chain.list_keys(),
            self.prover.clone(),
            txid_syncer,
        );
        self.poi_provider = Some(poi_provider);
    }

    pub fn set_state(&mut self, state: RailgunProviderState) -> Result<(), RailgunProviderError> {
        self.chain = get_chain_config(state.chain_id)
            .ok_or(RailgunProviderError::UnsupportedChainId(state.chain_id))?;
        self.utxo_indexer.set_state(state.indexer);
        Ok(())
    }

    /// Returns the provider's state as a serialized state object. Used to save state for
    /// future restoration.
    ///
    /// State does NOT include registered accounts. Accounts must be re-registered
    /// each time a provider is created.
    pub fn state(&self) -> RailgunProviderState {
        RailgunProviderState {
            chain_id: self.chain.id,
            indexer: self.utxo_indexer.state(),
        }
    }

    /// Register an account with the provider. The provider will index the account's
    /// transactions and balance as it syncs.
    ///
    /// Providers will NOT save registered accounts in their state. Accounts
    /// must be re-registered each time a provider is created.
    pub fn register(&mut self, account: Arc<dyn Signer>) {
        self.utxo_indexer.register(account);
    }

    /// Registers an account starting from a specific block.
    pub fn register_from(&mut self, account: Arc<dyn Signer>, from_block: u64) {
        self.utxo_indexer.register_from(account, from_block);
    }

    /// Returns the balance for the given address.
    ///
    /// If a POI provider is configured, only returns the spendable balance
    /// according to the POI provider.
    pub async fn balance(&mut self, address: RailgunAddress) -> HashMap<AssetId, u128> {
        let unspent = self.unspent(address).await;

        let mut balance_map = HashMap::new();
        for note in unspent {
            let asset = note.asset();
            let value = note.value();
            *balance_map.entry(asset).or_insert(0) += value;
        }

        balance_map
    }

    /// Helper to create a shield builder
    pub fn shield(&self) -> ShieldBuilder {
        ShieldBuilder::new(self.chain)
    }

    /// Helper to create a transaction builder
    pub fn transact(&self) -> TransactionBuilder {
        TransactionBuilder::new()
    }

    /// Build a executable transaction from a transaction builder
    pub async fn build<R: Rng>(
        &mut self,
        builder: TransactionBuilder,
        rng: &mut R,
    ) -> Result<ProvedTx, RailgunProviderError> {
        let in_notes = self.all_unspent().await;
        let operations = builder
            .build(
                self.prover.as_ref(),
                self.chain.id,
                &in_notes,
                &self.utxo_indexer.utxo_trees,
                rng,
            )
            .await?;

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.register_ops(&operations).await;
        }

        let proved_tx = ProvedTx::new(self.chain.railgun_smart_wallet, operations);
        Ok(proved_tx)
    }

    /// Build a transaction from a transaction builder into a broadcastable 4337 UserOp.
    pub async fn broadcast<R: Rng>(
        &mut self,
        builder: TransactionBuilder,
        rng: &mut R,
    ) -> Result<(), RailgunProviderError> {
        todo!()
    }

    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.sync_to(block_number).await?;

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.sync_to(block_number).await?;
        }

        Ok(())
    }

    pub async fn sync(&mut self) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.sync().await?;

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.sync().await?;
        }

        Ok(())
    }

    pub fn reset_indexer(&mut self) {
        self.utxo_indexer.reset();

        if let Some(poi_provider) = &mut self.poi_provider {
            poi_provider.reset();
        }
    }

    async fn all_unspent(&mut self) -> Vec<UtxoNote> {
        let addresses = self.utxo_indexer.registered();
        let mut all_notes = Vec::new();

        for address in addresses {
            let mut notes = self.unspent(address).await;
            all_notes.append(&mut notes);
        }
        all_notes
    }

    async fn unspent(&mut self, address: RailgunAddress) -> Vec<UtxoNote> {
        let notes = self.utxo_indexer.unspent(address);

        let Some(poi_provider) = &mut self.poi_provider else {
            return notes;
        };

        let mut spendable_notes = Vec::new();
        for note in notes {
            let spendable = poi_provider.spendable(note.blinded_commitment.into()).await;
            match spendable {
                Ok(true) => spendable_notes.push(note),
                Ok(false) => continue, //? Not spendable, skip
                Err(e) => {
                    //? If there's an error checking POI, log it and skip the note
                    error!("Error checking POI for note {:?}: {}", note, e);
                    continue;
                }
            }
        }

        spendable_notes
    }
}

use std::{collections::HashMap, sync::Arc};

use alloy::{primitives::ChainId, providers::DynProvider};
use rand::Rng;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    caip::AssetId,
    chain_config::{ChainConfig, get_chain_config},
    circuit::prover::TransactProver,
    railgun::{
        address::RailgunAddress,
        indexer::{NoteSyncer, UtxoIndexer, UtxoIndexerError, UtxoIndexerState},
        merkle_tree::SmartWalletUtxoVerifier,
        signer::Signer,
        transaction::{ProvedTx, ShieldBuilder, TransactionBuilder, TransactionBuilderError},
    },
};

/// Provides access to Railgun interactions
pub struct RailgunProvider {
    pub chain: ChainConfig,
    pub(crate) utxo_indexer: UtxoIndexer,
    pub(crate) prover: Arc<dyn TransactProver>,
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
}

/// General provider functions
impl RailgunProvider {
    pub fn new(
        chain: ChainConfig,
        provider: DynProvider,
        utxo_syncer: Arc<dyn NoteSyncer>,
        prover: Arc<dyn TransactProver>,
    ) -> Self {
        let utxo_verifier = Arc::new(SmartWalletUtxoVerifier::new(
            chain.railgun_smart_wallet,
            provider.clone(),
        ));

        Self {
            chain,
            utxo_indexer: UtxoIndexer::new(utxo_syncer, utxo_verifier),
            prover,
        }
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
    /// Providers will NOT retroactively index transactions for an account.
    /// Providers will NOT save registered accounts in their state. Accounts
    /// must be re-registered each time a provider is created.
    pub fn register(&mut self, account: Arc<dyn Signer>) {
        self.utxo_indexer.register(account);
    }

    /// Register an account with the provider and trigger a provider re-sync
    /// starting from the provided block number. The provider will index the
    /// account's transactions and balance as it syncs.
    pub async fn register_resync(
        &mut self,
        account: Arc<dyn Signer>,
        from_block: u64,
    ) -> Result<(), RailgunProviderError> {
        self.utxo_indexer
            .register_resync(account, from_block)
            .await?;
        Ok(())
    }

    /// Returns the raw balance for the given address
    pub fn balance(&self, address: RailgunAddress) -> HashMap<AssetId, u128> {
        self.utxo_indexer.balance(address)
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
        &self,
        builder: TransactionBuilder,
        rng: &mut R,
    ) -> Result<ProvedTx, RailgunProviderError> {
        Ok(builder
            .build(
                self.chain.clone(),
                &self.utxo_indexer,
                self.prover.as_ref(),
                rng,
            )
            .await?)
    }

    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.sync_to(block_number).await?;
        Ok(())
    }

    pub async fn sync(&mut self) -> Result<(), RailgunProviderError> {
        self.utxo_indexer.sync().await?;
        Ok(())
    }

    pub fn reset_indexer(&mut self) {
        self.utxo_indexer.reset();
    }
}

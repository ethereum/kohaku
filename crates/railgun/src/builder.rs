use std::sync::Arc;

use eip_1193_provider::provider::{Eip1193Provider, IntoEip1193Provider};

use crate::{
    chain_config::ChainConfig,
    circuit::groth16_prover::Groth16Prover,
    database::{Database, memory::InMemoryDatabase},
    indexer::{
        syncer::{ChainedSyncer, RpcSyncer, SubsquidSyncer, UtxoSyncer},
        utxo_indexer::UtxoIndexer,
    },
    merkle_tree::SmartWalletUtxoVerifier,
    poi::provider::PoiProvider,
    provider::{RailgunProvider, RailgunProviderError},
};

/// Builder for constructing a `RailgunProvider`.
pub struct RailgunBuilder {
    chain: ChainConfig,
    provider: Arc<dyn Eip1193Provider>,
    db: Option<Arc<dyn Database>>,
    utxo_syncer: Option<Arc<dyn UtxoSyncer>>,
    poi: bool,
}

impl RailgunBuilder {
    #[must_use]
    pub fn new(chain: ChainConfig, provider: impl IntoEip1193Provider) -> Self {
        Self {
            chain,
            provider: provider.into_eip1193(),
            db: None,
            utxo_syncer: None,
            poi: false,
        }
    }

    /// Sets a custom database for the provider. If not set, an in-memory database
    /// will be used.
    ///
    /// Providers will use the database for storing synced UTXO data, POI proofs, and other internal
    /// state. Sensitive data such as a user's unencrypted notes will be stored. Private key
    /// material will never be stored in the database.
    #[must_use]
    pub fn with_database(mut self, db: Arc<dyn Database>) -> Self {
        self.db = Some(db);
        self
    }

    /// Sets a custom UTXO syncer for the provider. If not set, a default subsquid + RPC syncer will
    /// be used.
    #[must_use]
    pub fn with_utxo_syncer(mut self, syncer: Arc<dyn UtxoSyncer>) -> Self {
        self.utxo_syncer = Some(syncer);
        self
    }

    /// Enables POI (Proof of innocence) support for the provider.
    ///
    /// Uses the default chain-specific POI endpoints and list keys from the chain config. Enabling
    /// this tells the builder to submit POI proofs when spending notes and to only spend
    /// notes that have been marked as `spendable` by the POI provider.
    #[must_use]
    pub fn with_poi(mut self) -> Self {
        self.poi = true;
        self
    }

    /// Builds the `RailgunProvider` with the specified configuration.
    #[must_use]
    pub async fn build(self) -> Result<RailgunProvider, RailgunProviderError> {
        let db = self.db.unwrap_or_else(|| Arc::new(InMemoryDatabase::new()));

        let utxo_syncer = self.utxo_syncer.unwrap_or_else(|| {
            Arc::new(
                ChainedSyncer::new()
                    .then(SubsquidSyncer::new(&self.chain.subsquid_endpoint))
                    .then(RpcSyncer::new(self.chain.clone(), self.provider.clone())),
            )
        });

        let utxo_verifier = Arc::new(SmartWalletUtxoVerifier::new(
            self.chain.railgun_smart_wallet,
            self.provider.clone(),
        ));

        let utxo_indexer = UtxoIndexer::new(db.clone(), utxo_syncer, utxo_verifier).await?;

        let prover = Groth16Prover::new();

        let poi_provider = if self.poi {
            let txid_syncer = Arc::new(SubsquidSyncer::new(&self.chain.subsquid_endpoint));

            let poi_provider = PoiProvider::new(
                self.chain.id,
                db,
                txid_syncer,
                self.chain.poi_endpoint.clone(),
                self.chain.list_keys.clone(),
            )
            .await?;
            Some(poi_provider)
        } else {
            None
        };

        RailgunProvider::new(
            self.chain,
            self.provider,
            utxo_indexer,
            prover,
            poi_provider,
        )
        .await
    }
}

use std::sync::Arc;

use eip_1193_provider::provider::{Eip1193Provider, IntoEip1193Provider};

use crate::{
    chain_config::ChainConfig,
    circuit::{
        groth16_prover::Groth16Prover, prover::Prover, remote_artifact_loader::RemoteArtifactLoader,
    },
    database::{Database, InMemoryDatabase},
    indexer::{
        ChainedSyncer, NoteSyncer, RpcSyncer, SubsquidSyncer, TransactionSyncer, UtxoIndexer,
    },
    merkle_tree::{MerkleTreeVerifier, SmartWalletUtxoVerifier},
    poi::PoiProvider,
    provider::{RailgunProvider, RailgunProviderError},
};

pub struct RailgunBuilder {
    chain: ChainConfig,
    provider: Arc<dyn Eip1193Provider>,
    db: Option<Arc<dyn Database>>,
    utxo_syncer: Option<Arc<dyn NoteSyncer>>,
    utxo_verifier: Option<Arc<dyn MerkleTreeVerifier>>,
    prover: Option<Arc<dyn Prover>>,
    poi: Option<PoiConfig>,
}

#[derive(Default)]
pub struct PoiConfig {
    txid_syncer: Option<Arc<dyn TransactionSyncer>>,
}

impl RailgunBuilder {
    #[must_use]
    pub fn new(chain: ChainConfig, provider: impl IntoEip1193Provider) -> Self {
        Self {
            chain,
            provider: provider.into_eip1193(),
            db: None,
            utxo_syncer: None,
            utxo_verifier: None,
            prover: None,
            poi: None,
        }
    }

    #[must_use]
    pub fn with_database(mut self, db: Arc<dyn Database>) -> Self {
        self.db = Some(db);
        self
    }

    #[must_use]
    pub fn with_utxo_syncer(mut self, syncer: Arc<dyn NoteSyncer>) -> Self {
        self.utxo_syncer = Some(syncer);
        self
    }

    #[must_use]
    pub fn with_utxo_verifier(mut self, verifier: Arc<dyn MerkleTreeVerifier>) -> Self {
        self.utxo_verifier = Some(verifier);
        self
    }

    #[must_use]
    pub fn with_prover(mut self, prover: Arc<dyn Prover>) -> Self {
        self.prover = Some(prover);
        self
    }

    #[must_use]
    pub fn with_poi(mut self) -> Self {
        self.poi = Some(PoiConfig::default());
        self
    }

    #[must_use]
    pub fn with_poi_config(mut self, config: PoiConfig) -> Self {
        self.poi = Some(config);
        self
    }

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

        let utxo_verifier = self.utxo_verifier.unwrap_or_else(|| {
            Arc::new(SmartWalletUtxoVerifier::new(
                self.chain.railgun_smart_wallet,
                self.provider.clone(),
            ))
        });

        let utxo_indexer = UtxoIndexer::new(db.clone(), utxo_syncer, utxo_verifier).await?;

        let prover = self.prover.unwrap_or_else(|| {
            Arc::new(Groth16Prover::new(
                Arc::new(RemoteArtifactLoader::default()),
            ))
        });

        let poi_provider = match self.poi {
            Some(config) => Some(config.build(&self.chain, db.clone()).await?),
            None => None,
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

impl PoiConfig {
    #[must_use]
    pub fn with_txid_syncer(mut self, syncer: Arc<dyn TransactionSyncer>) -> Self {
        self.txid_syncer = Some(syncer);
        self
    }

    async fn build(
        self,
        chain: &ChainConfig,
        db: Arc<dyn Database>,
    ) -> Result<PoiProvider, RailgunProviderError> {
        let txid_syncer = self
            .txid_syncer
            .unwrap_or_else(|| Arc::new(SubsquidSyncer::new(&chain.subsquid_endpoint)));

        let poi_provider = PoiProvider::new(
            chain.id,
            db,
            chain.poi_endpoint.clone(),
            chain.list_keys.clone(),
            txid_syncer,
        )
        .await?;

        Ok(poi_provider)
    }
}

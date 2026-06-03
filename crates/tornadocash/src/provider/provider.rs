use std::sync::Arc;

use alloy::primitives::Address;
use eip_1193_provider::tx_data::TxData;
use rand::CryptoRng;
use ruint::aliases::U256;
use thiserror::Error;

use crate::{
    circuit::artifacts::RemoteArtifactLoader,
    indexer::{syncer::Syncer, verifier::Verifier},
    provider::{
        note::Note,
        pool::Pool,
        pool_provider::{PoolProvider, PoolProviderError},
    },
};

/// TornadoProvider manages multiple pools and provides a unified interface for
/// deposits and withdrawals
pub struct TornadoProvider {
    syncer: Arc<dyn Syncer>,
    verifier: Arc<dyn Verifier>,

    pools: Vec<PoolProvider>,
    artifact_loader: RemoteArtifactLoader,
}

#[derive(Debug, Error)]
pub enum TornadoProviderError {
    #[error("Unknown pool: amount={0}, symbol={1}, chain_id={2}")]
    UnknownPool(String, String, u64),
    #[error(transparent)]
    Pool(#[from] PoolProviderError),
}

impl TornadoProvider {
    pub fn new(syncer: Arc<dyn Syncer>, verifier: Arc<dyn Verifier>) -> Self {
        let artifact_loader = RemoteArtifactLoader::default();
        Self {
            syncer,
            verifier,
            pools: Vec::new(),
            artifact_loader,
        }
    }

    /// Get a mutable reference to the provider for a given pool, creating it if it doesn't exist.
    pub fn pool(&mut self, pool: Pool) -> &mut PoolProvider {
        if let Some(i) = self.pools.iter().position(|p| *p.pool() == pool) {
            return &mut self.pools[i];
        }

        let provider = PoolProvider::new(
            self.syncer.clone(),
            self.verifier.clone(),
            self.artifact_loader.clone(),
            pool,
        );

        self.pools.retain(|p| *p.pool() != pool);
        self.pools.push(provider);
        self.pools.last_mut().unwrap()
    }

    /// Create a deposit transaction and note for a given pool.
    pub fn deposit(&mut self, pool: Pool, rng: &mut impl CryptoRng) -> (TxData, Note) {
        let provider = self.pool(pool);
        provider.deposit(rng)
    }

    /// Create a withdrawal transaction.
    pub async fn withdraw(
        &mut self,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
        rng: &mut impl CryptoRng,
    ) -> Result<TxData, TornadoProviderError> {
        let pool = Pool::from_id(&note.amount, &note.symbol, note.chain_id).ok_or_else(|| {
            TornadoProviderError::UnknownPool(
                note.amount.clone(),
                note.symbol.clone(),
                note.chain_id,
            )
        })?;

        let provider = self.pool(pool);
        provider.sync().await?;
        Ok(provider
            .withdraw(note, recipient, relayer, fee, refund, rng)
            .await?)
    }

    /// Manually trigger a sync of the provider for all pools.
    pub async fn sync(&mut self) -> Result<(), TornadoProviderError> {
        for provider in self.pools.iter_mut() {
            provider.sync().await?;
        }
        Ok(())
    }

    /// Manually trigger a sync of the provider for all pools up to the given block.
    pub async fn sync_to(&mut self, block: u64) -> Result<(), TornadoProviderError> {
        for provider in self.pools.iter_mut() {
            provider.sync_to(block).await?;
        }
        Ok(())
    }
}

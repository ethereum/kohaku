use std::sync::Arc;

use alloy::primitives::Address;
use kohaku_db::Database;
use rand::CryptoRng;
use ruint::aliases::U256;
use thiserror::Error;

use crate::{
    indexer::{syncer::Syncer, verifier::Verifier},
    provider::{
        note::Note,
        pool::Pool,
        pool_provider::{PoolProvider, PoolProviderError, TxData},
    },
};

/// A provider for multiple tornadocash pools.
///
/// The provider manages multiple `PoolProvider`s for requested pools, providing a unified
/// interface.
pub struct TornadoProvider {
    db: Arc<dyn Database>,
    syncer: Arc<dyn Syncer>,
    verifier: Arc<dyn Verifier>,

    pools: Vec<PoolProvider>,
}

#[derive(Debug, Error)]
pub enum TornadoProviderError {
    #[error("Unknown pool: amount={0}, symbol={1}, chain_id={2}")]
    UnknownPool(String, String, u64),
    #[error("Pool not initialized: {0}")]
    PoolNotInitialized(Pool),
    #[error(transparent)]
    Pool(#[from] PoolProviderError),
}

impl TornadoProvider {
    pub fn new(
        db: Arc<dyn Database>,
        syncer: Arc<dyn Syncer>,
        verifier: Arc<dyn Verifier>,
    ) -> Self {
        Self {
            db,
            syncer,
            verifier,
            pools: Vec::new(),
        }
    }

    /// Get a mutable reference to the provider for a given pool, creating it if it doesn't exist.
    pub async fn pool(&mut self, pool: Pool) -> Result<&mut PoolProvider, PoolProviderError> {
        if let Some(i) = self.pools.iter().position(|p| *p.pool() == pool) {
            return Ok(&mut self.pools[i]);
        }

        let provider = PoolProvider::new(
            self.db.clone(),
            pool,
            self.syncer.clone(),
            self.verifier.clone(),
        )
        .await?;

        self.pools.retain(|p| *p.pool() != pool);
        self.pools.push(provider);
        Ok(self.pools.last_mut().unwrap())
    }

    /// Create a deposit transaction and note for a given pool.
    ///
    /// The pool must already be initialized (e.g. via [`TornadoProvider::pool`]); otherwise
    /// returns [`TornadoProviderError::PoolNotInitialized`].
    pub fn deposit(
        &self,
        pool: Pool,
        rng: &mut impl CryptoRng,
    ) -> Result<(TxData, Note), TornadoProviderError> {
        let provider = self
            .pools
            .iter()
            .find(|p| *p.pool() == pool)
            .ok_or(TornadoProviderError::PoolNotInitialized(pool))?;
        Ok(provider.deposit(rng))
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

        let provider = self.pool(pool).await?;
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

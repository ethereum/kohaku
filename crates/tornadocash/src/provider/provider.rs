use std::sync::Arc;

use alloy::{primitives::Address, providers::DynProvider, sol_types::SolCall};
use kohaku_db::Database;
use rand::CryptoRng;
use ruint::aliases::U256;
use thiserror::Error;

use crate::{
    abis::tornado::Tornado,
    indexer::{rpc::RpcSyncer, syncer::Syncer, verifier::Verifier},
    provider::{
        call::Call,
        note::Note,
        pool::Pool,
        pool_provider::{PoolProvider, PoolProviderError},
    },
};

/// A provider for multiple tornadocash pools.
///
/// The provider manages multiple `PoolProvider`s for requested pools, providing a unified
/// interface.
pub struct TornadoProvider {
    provider: DynProvider,
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
        provider: DynProvider,
        db: Arc<dyn Database>,
        syncer: Arc<dyn Syncer>,
        verifier: Arc<dyn Verifier>,
    ) -> Self {
        Self {
            provider,
            db,
            syncer,
            verifier,
            pools: Vec::new(),
        }
    }

    pub fn from_rpc(provider: DynProvider, db: Arc<dyn Database>) -> Self {
        let syncer = Arc::new(RpcSyncer::new(provider.clone()));
        Self::new(provider, db, syncer.clone(), syncer)
    }

    /// Get a mutable reference to the provider for a given pool, creating it if it doesn't exist.
    pub async fn pool(&mut self, pool: Pool) -> Result<&mut PoolProvider, PoolProviderError> {
        if let Some(i) = self.pools.iter().position(|p| *p.pool() == pool) {
            return Ok(&mut self.pools[i]);
        }

        let provider = PoolProvider::new(
            pool,
            self.provider.clone(),
            self.db.clone(),
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
    ) -> Result<(Call, Note), TornadoProviderError> {
        let provider = self
            .pools
            .iter()
            .find(|p| *p.pool() == pool)
            .ok_or(TornadoProviderError::PoolNotInitialized(pool))?;
        Ok(provider.deposit(rng))
    }

    /// Create a withdrawal transaction for the given note to the recipient address.
    ///
    /// # Errors
    /// Returns an error if the pool cannot be found, is not initialized, or if the withdrawal
    /// cannot be created.
    pub async fn withdraw(
        &mut self,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
        rng: &mut impl CryptoRng,
    ) -> Result<Call, TornadoProviderError> {
        let pool = self.pool_from_note(note)?;

        let data = self
            .withdraw_call(note, recipient, relayer, fee, refund, rng)
            .await?
            .abi_encode();

        Ok(Call::new(
            pool.address,
            data.into(),
            refund.unwrap_or_default(),
        ))
    }

    /// Create withdrawal calldata.
    ///
    /// # Errors
    /// Returns an error if the pool cannot be found, is not initialized, or if the withdrawal
    /// calldata cannot be created.
    pub async fn withdraw_call(
        &mut self,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
        rng: &mut impl CryptoRng,
    ) -> Result<Tornado::withdrawCall, TornadoProviderError> {
        let pool = self.pool_from_note(note)?;

        let provider = self.pool(pool).await?;
        provider.sync().await?;
        Ok(provider
            .withdraw_call(note, recipient, relayer, fee, refund, rng)
            .await?)
    }

    pub async fn quote_wei_in_fee_token(
        &mut self,
        pool: Pool,
        wei_amount: U256,
    ) -> Result<U256, TornadoProviderError> {
        let provider = self.pool(pool).await?;
        Ok(provider.quote_wei_in_fee_token(wei_amount).await?)
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

    /// Get the pool for a given note.
    pub(crate) fn pool_from_note(&self, note: &Note) -> Result<Pool, TornadoProviderError> {
        Pool::from_id(&note.amount, &note.symbol, note.chain_id).ok_or_else(|| {
            TornadoProviderError::UnknownPool(
                note.amount.clone(),
                note.symbol.clone(),
                note.chain_id,
            )
        })
    }
}

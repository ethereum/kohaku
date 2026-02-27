use std::sync::Arc;

use alloy::primitives::Address;
use prover::Prover;
use rand::Rng;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::warn;

use crate::{
    abis::tornado::Tornado,
    indexer::{Syncer, Verifier},
    note::Note,
    provider::{
        pool::Pool,
        pool_provider::{PoolProvider, PoolProviderError, PoolProviderState},
    },
    tx_data::TxData,
};

/// TornadoProvider manages multiple pools and provides a unified interface for
/// deposits and withdrawals
pub struct TornadoProvider {
    pools: Vec<PoolProvider>,

    syncer: Arc<dyn Syncer>,
    verifier: Arc<dyn Verifier>,
    prover: Arc<dyn Prover>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TornadoProviderState {
    pub pool_states: Vec<PoolProviderState>,
}

#[derive(Debug, Error)]
pub enum TornadoProviderError {
    #[error("Missing pool: {0}")]
    MissingPool(Pool),
    #[error("Pool error: {0}")]
    Pool(#[from] PoolProviderError),
}

impl TornadoProvider {
    pub fn new(
        syncer: Arc<dyn Syncer>,
        verifier: Arc<dyn Verifier>,
        prover: Arc<dyn Prover>,
    ) -> Self {
        Self {
            pools: Vec::new(),
            syncer,
            verifier,
            prover,
        }
    }

    pub fn from_state(
        syncer: Arc<dyn Syncer>,
        verifier: Arc<dyn Verifier>,
        prover: Arc<dyn Prover>,
        state: TornadoProviderState,
    ) -> Self {
        let mut provider = Self::new(syncer, verifier, prover);
        for pool_state in state.pool_states {
            provider.add_pool_from_state(pool_state);
        }
        provider
    }

    pub fn add_pool(&mut self, pool: Pool) {
        let provider = PoolProvider::new(
            self.syncer.clone(),
            self.verifier.clone(),
            self.prover.clone(),
            pool,
        );

        let pool = provider.pool();
        if let Ok(_) = self.pool(&pool) {
            warn!("Overwriting existing provider for pool: {}", pool.address);
        }

        self.pools.retain(|p| p.pool() != pool);
        self.pools.push(provider);
    }

    pub fn add_pool_provider(&mut self, provider: PoolProvider) {
        let pool = provider.pool();
        if let Ok(_) = self.pool(&pool) {
            warn!("Overwriting existing provider for pool: {}", pool.address);
        }

        self.pools.retain(|p| p.pool() != pool);
        self.pools.push(provider);
    }

    pub fn add_pool_from_state(&mut self, state: PoolProviderState) {
        let provider = PoolProvider::from_state(
            self.syncer.clone(),
            self.verifier.clone(),
            self.prover.clone(),
            state,
        );

        let pool = provider.pool();
        if let Ok(_) = self.pool(&pool) {
            warn!("Overwriting existing provider for pool: {}", pool.address);
        }

        self.pools.retain(|p| p.pool() != pool);
        self.pools.push(provider);
    }

    pub fn pool(&self, pool: &Pool) -> Result<&PoolProvider, TornadoProviderError> {
        self.pools
            .iter()
            .find(|p| p.pool() == pool)
            .ok_or(TornadoProviderError::MissingPool(pool.clone()))
    }

    pub fn state(&self) -> TornadoProviderState {
        let pool_states = self.pools.iter().map(|provider| provider.state()).collect();
        TornadoProviderState { pool_states }
    }

    /// Create a deposit transaction
    pub fn deposit<R: Rng>(
        &self,
        pool: &Pool,
        rng: &mut R,
    ) -> Result<(TxData, Note), TornadoProviderError> {
        let provider = self.pool(pool)?;
        Ok(provider.deposit(rng))
    }

    /// Create a withdrawal transaction
    pub async fn withdraw(
        &self,
        pool: &Pool,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
    ) -> Result<TxData, TornadoProviderError> {
        let provider = self.pool(pool)?;
        Ok(provider
            .withdraw(note, recipient, relayer, fee, refund)
            .await?)
    }

    /// Create the calldata for a withdrawal transaction
    pub async fn withdraw_calldata(
        &self,
        pool: &Pool,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
    ) -> Result<Tornado::withdrawCall, TornadoProviderError> {
        let provider = self.pool(pool)?;
        Ok(provider
            .withdraw_calldata(note, recipient, relayer, fee, refund)
            .await?)
    }

    pub async fn sync(&mut self) -> Result<(), TornadoProviderError> {
        for provider in self.pools.iter_mut() {
            provider.sync().await?;
        }
        Ok(())
    }

    pub async fn sync_to(&mut self, block: u64) -> Result<(), TornadoProviderError> {
        for provider in self.pools.iter_mut() {
            provider.sync_to(block).await?;
        }
        Ok(())
    }
}

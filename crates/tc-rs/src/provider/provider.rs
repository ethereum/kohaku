use std::sync::Arc;

use alloy_primitives::Address;
use eth_rpc::{EthRpcClient, TxData};
use prover::Prover;
use rand::Rng;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    abis::tornado::Tornado,
    indexer::{RpcSyncer, Syncer, Verifier},
    note::Note,
    provider::{
        pool::Pool,
        pool_provider::{PoolProvider, PoolProviderError, PoolProviderState},
    },
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
    #[error("Unknown pool: amount={0}, symbol={1}, chain_id={2}")]
    UnknownPool(String, String, u64),
    #[error("Pool error: {0}")]
    Pool(#[from] PoolProviderError),
}

impl TornadoProvider {
    pub fn new(
        rpc: Arc<dyn EthRpcClient>,
        syncer: Arc<dyn Syncer>,
        prover: Arc<dyn Prover>,
    ) -> Self {
        let verifier = Arc::new(RpcSyncer::new(rpc));
        Self {
            pools: Vec::new(),
            syncer,
            verifier,
            prover,
        }
    }

    pub fn from_state(
        rpc: Arc<dyn EthRpcClient>,
        syncer: Arc<dyn Syncer>,
        prover: Arc<dyn Prover>,
        state: TornadoProviderState,
    ) -> Result<Self, TornadoProviderError> {
        let mut provider = Self::new(rpc, syncer, prover);
        for pool_state in state.pool_states {
            provider.add_pool_from_state(pool_state)?;
        }
        Ok(provider)
    }

    pub fn pool(&mut self, pool: &Pool) -> &mut PoolProvider {
        if let Some(i) = self.pools.iter().position(|p| p.pool() == pool) {
            return &mut self.pools[i];
        }
        self.add_pool(*pool)
    }

    pub fn state(&self) -> TornadoProviderState {
        let pool_states = self.pools.iter().map(|provider| provider.state()).collect();
        TornadoProviderState { pool_states }
    }

    /// Create a deposit transaction
    pub fn deposit<R: Rng>(&mut self, pool: &Pool, rng: &mut R) -> (TxData, Note) {
        let provider = self.pool(pool);
        provider.deposit(rng)
    }

    /// Create a withdrawal transaction
    pub async fn withdraw(
        &mut self,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
    ) -> Result<TxData, TornadoProviderError> {
        let pool = Pool::from_id(&note.amount, &note.symbol, note.chain_id).ok_or_else(|| {
            TornadoProviderError::UnknownPool(
                note.amount.clone(),
                note.symbol.clone(),
                note.chain_id,
            )
        })?;

        let provider = self.pool(&pool);
        provider.sync().await?;
        Ok(provider
            .withdraw(note, recipient, relayer, fee, refund)
            .await?)
    }

    /// Create the calldata for a withdrawal transaction
    pub async fn withdraw_calldata(
        &mut self,
        note: &Note,
        recipient: Address,
        relayer: Option<Address>,
        fee: Option<U256>,
        refund: Option<U256>,
    ) -> Result<Tornado::withdrawCall, TornadoProviderError> {
        let pool = Pool::from_id(&note.amount, &note.symbol, note.chain_id).ok_or_else(|| {
            TornadoProviderError::UnknownPool(
                note.amount.clone(),
                note.symbol.clone(),
                note.chain_id,
            )
        })?;

        let provider = self.pool(&pool);
        provider.sync().await?;
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

    fn add_pool(&mut self, pool: Pool) -> &mut PoolProvider {
        let provider = PoolProvider::new(
            self.syncer.clone(),
            self.verifier.clone(),
            self.prover.clone(),
            pool,
        );

        self.pools.retain(|p| *p.pool() != pool);
        self.pools.push(provider);
        self.pools.last_mut().unwrap()
    }

    fn add_pool_from_state(
        &mut self,
        state: PoolProviderState,
    ) -> Result<(), TornadoProviderError> {
        let provider = PoolProvider::from_state(
            self.syncer.clone(),
            self.verifier.clone(),
            self.prover.clone(),
            state,
        )?;

        self.pools.retain(|p| *p.pool() != *provider.pool());
        self.pools.push(provider);
        Ok(())
    }
}

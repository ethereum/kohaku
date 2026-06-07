use thiserror::Error;

use crate::{
    abis::tornado::Tornado::{Deposit, Withdrawal},
    provider::pool::Pool,
};

#[derive(Debug, Error)]
pub enum SyncerError {
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait Syncer: common::MaybeSend {
    async fn latest_block(&self, pool: &Pool) -> Result<u64, SyncerError>;

    async fn sync(
        &self,
        pool: &Pool,
        from_block: u64,
        to_block: u64,
    ) -> Result<Vec<SyncEvent>, SyncerError>;
}

pub enum SyncEvent {
    Deposit(Deposit),
    Withdrawal(Withdrawal),
}

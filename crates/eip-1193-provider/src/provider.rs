use std::sync::Arc;

use alloy::{
    primitives::{Address, Bytes, FixedBytes, Log},
    sol_types::SolCall,
};
use common::MaybeSend;
use serde::{Deserialize, Serialize};
use thiserror::Error;

// TODO: Split me up into multiple per-domain traits (logs, receipts, gas,
// transactions, caller, etc)
//
// TODO: Ensure I'm a fully compliant EIP-1193 provider
#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait Eip1193Provider: MaybeSend {
    async fn get_chain_id(&self) -> Result<u64, Eip1193Error>;

    async fn get_block_number(&self) -> Result<u64, Eip1193Error>;

    async fn logs(
        &self,
        address: Address,
        event_signature: Option<FixedBytes<32>>,
        from_block: Option<u64>,
        to_block: Option<u64>,
    ) -> Result<Vec<RawLog>, Eip1193Error>;

    async fn eth_call(&self, to: Address, data: Bytes) -> Result<Bytes, Eip1193Error>;

    async fn estimate_gas(
        &self,
        to: Address,
        data: Bytes,
        from: Option<Address>,
    ) -> Result<u64, Eip1193Error>;

    async fn gas_price(&self) -> Result<u128, Eip1193Error>;

    async fn transaction_count(
        &self,
        address: Address,
        block: Option<u64>,
    ) -> Result<u64, Eip1193Error>;
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait Eip1193Caller: Eip1193Provider {
    async fn sol_call<C: SolCall + common::MaybeSend>(
        &self,
        to: Address,
        call: C,
    ) -> Result<C::Return, Eip1193Error> {
        let data = call.abi_encode().into();
        let ret = self.eth_call(to, data).await?;
        C::abi_decode_returns(&ret).map_err(|e| Eip1193Error::Decode(e.to_string()))
    }
}

pub trait IntoEip1193Provider {
    fn into_eip1193(self) -> Arc<dyn Eip1193Provider>;
}

impl<T> Eip1193Caller for T where T: Eip1193Provider + ?Sized {}

impl<T> IntoEip1193Provider for Arc<T>
where
    T: Eip1193Provider + 'static,
{
    fn into_eip1193(self) -> Arc<dyn Eip1193Provider> {
        self
    }
}

impl IntoEip1193Provider for Arc<dyn Eip1193Provider> {
    fn into_eip1193(self) -> Arc<dyn Eip1193Provider> {
        self
    }
}

#[derive(Debug, Error)]
pub enum Eip1193Error {
    #[error("RPC error: {0}")]
    Rpc(String),
    #[error("Decode error: {0}")]
    Decode(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(target_arch = "wasm32", derive(tsify::Tsify))]
pub struct RawLog {
    #[cfg_attr(target_arch = "wasm32", tsify(type = "number | null"))]
    pub block_number: Option<u64>,

    #[cfg_attr(target_arch = "wasm32", tsify(type = "number | null"))]
    pub block_timestamp: Option<u64>,

    #[cfg_attr(target_arch = "wasm32", tsify(type = "`0x${string}` | null"))]
    pub transaction_hash: Option<FixedBytes<32>>,

    #[cfg_attr(target_arch = "wasm32", tsify(type = "`0x${string}`"))]
    pub address: Address,

    #[cfg_attr(target_arch = "wasm32", tsify(type = "`0x${string}`[]"))]
    pub topics: Vec<FixedBytes<32>>,

    #[cfg_attr(target_arch = "wasm32", tsify(type = "`0x${string}`"))]
    pub data: Bytes,
}

impl RawLog {
    pub fn inner(&self) -> Log {
        Log::new_unchecked(self.address, self.topics.clone(), self.data.clone())
    }
}

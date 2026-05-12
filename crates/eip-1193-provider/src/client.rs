use alloy::{
    primitives::{Address, Bytes, FixedBytes, Log},
    sol_types::SolCall,
};
use common::MaybeSend;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait Eip1193Provider: MaybeSend {
    async fn chain_id(&self) -> Result<u64, Eip1193Error>;

    async fn block_number(&self) -> Result<u64, Eip1193Error>;

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

pub async fn eth_call_sol<C>(
    provider: &dyn Eip1193Provider,
    to: Address,
    call: C,
) -> Result<C::Return, Eip1193Error>
where
    C: SolCall,
{
    let data = call.abi_encode();
    let raw = provider.eth_call(to, data.into()).await?;
    C::abi_decode_returns(&raw).map_err(|e| Eip1193Error::Decode(e.to_string()))
}

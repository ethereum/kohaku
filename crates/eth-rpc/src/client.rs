use alloy_primitives::{Address, Bytes, FixedBytes, Log};
use alloy_sol_types::SolCall;
use common::MaybeSend;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait EthRpcClient: MaybeSend {
    async fn get_chain_id(&self) -> Result<u64, EthRpcClientError>;

    async fn get_block_number(&self) -> Result<u64, EthRpcClientError>;

    async fn get_logs(
        &self,
        address: Address,
        event_signature: Option<FixedBytes<32>>,
        from_block: Option<u64>,
        to_block: Option<u64>,
    ) -> Result<Vec<RawLog>, EthRpcClientError>;

    async fn eth_call(&self, to: Address, data: Bytes) -> Result<Bytes, EthRpcClientError>;

    async fn estimate_gas(
        &self,
        to: Address,
        data: Bytes,
        from: Option<Address>,
    ) -> Result<u64, EthRpcClientError>;

    async fn get_gas_price(&self) -> Result<u128, EthRpcClientError>;
}

#[derive(Debug, Error)]
pub enum EthRpcClientError {
    #[error("RPC error: {0}")]
    Rpc(String),
    #[error("Decode error: {0}")]
    Decode(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    provider: &dyn EthRpcClient,
    to: Address,
    call: C,
) -> Result<C::Return, EthRpcClientError>
where
    C: SolCall,
{
    let data = call.abi_encode();
    let raw = provider.eth_call(to, data.into()).await?;
    C::abi_decode_returns(&raw).map_err(|e| EthRpcClientError::Decode(e.to_string()))
}

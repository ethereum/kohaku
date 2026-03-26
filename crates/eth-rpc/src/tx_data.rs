use alloy_primitives::{Address, Bytes, U256};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(target_arch = "wasm32", derive(tsify::Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct TxData {
    #[cfg_attr(target_arch = "wasm32", tsify(type = "`0x${string}`"))]
    pub to: Address,
    #[cfg_attr(target_arch = "wasm32", tsify(type = "`0x${string}`"))]
    pub data: Bytes,
    #[cfg_attr(target_arch = "wasm32", tsify(type = "`0x${string}`"))]
    pub value: U256,
}

impl TxData {
    pub fn new(to: Address, data: Bytes, value: U256) -> Self {
        TxData { to, data, value }
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl From<TxData> for alloy::rpc::types::TransactionRequest {
    fn from(tx_data: TxData) -> Self {
        alloy::rpc::types::TransactionRequest::default()
            .to(tx_data.to)
            .input(tx_data.data.into())
            .value(tx_data.value)
    }
}

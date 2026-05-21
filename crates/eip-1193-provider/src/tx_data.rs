use alloy::primitives::{Address, Bytes, U256};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi))]
pub struct TxData {
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub to: Address,
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub data: Bytes,
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub value: U256,
}

impl TxData {
    pub fn new(to: Address, data: Bytes, value: U256) -> Self {
        TxData { to, data, value }
    }
}

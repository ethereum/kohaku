mod client;
mod tx_data;

pub use tx_data::TxData;

#[cfg(not(target_arch = "wasm32"))]
pub mod alloy_impl;

#[cfg(target_arch = "wasm32")]
pub mod wasm_impl;

pub use client::{EthRpcClient, EthRpcClientError, RawLog, eth_call_sol};
#[cfg(target_arch = "wasm32")]
pub use wasm_impl::JsEthRpcAdapter;

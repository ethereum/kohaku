use alloy::{
    network::Ethereum,
    providers::{DynProvider, Provider, ProviderBuilder},
};
use wasm_bindgen::JsValue;

use crate::chain_config::{ChainConfig, get_chain_config};

pub fn try_get_chain(chain_id: u64) -> Result<ChainConfig, JsValue> {
    get_chain_config(chain_id)
        .ok_or_else(|| JsValue::from_str(&format!("Unsupported chain ID: {}", chain_id)))
}

pub async fn new_dyn_provider(rpc_url: &str) -> Result<DynProvider, JsValue> {
    let provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .connect(rpc_url)
        .await
        .map_err(|e| JsValue::from_str(&format!("Failed to connect to RPC: {}", e)))?
        .erased();

    Ok(provider)
}

use wasm_bindgen::JsValue;

use crate::chain_config::{ChainConfig, get_chain_config};

pub fn try_get_chain(chain_id: u64) -> Result<ChainConfig, JsValue> {
    get_chain_config(chain_id)
        .ok_or_else(|| JsValue::from_str(&format!("Unsupported chain ID: {}", chain_id)))
}

use std::str::FromStr;

use alloy::primitives::Address;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::caip::AssetId;

#[wasm_bindgen]
pub fn erc20(address: String) -> Result<AssetId, JsValue> {
    let address = Address::from_str(&address)
        .map_err(|e| JsValue::from_str(&format!("Invalid ERC20 address: {e}")))?;
    Ok(AssetId::Erc20(address))
}

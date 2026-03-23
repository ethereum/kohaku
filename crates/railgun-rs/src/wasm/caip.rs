use std::str::FromStr;

use alloy_primitives::{Address, U256};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::caip::AssetId;

#[wasm_bindgen]
pub fn erc20(address: String) -> Result<AssetId, JsValue> {
    let address = Address::from_str(&address)
        .map_err(|e| JsValue::from_str(&format!("Invalid ERC20 address: {e}")))?;
    Ok(AssetId::Erc20(address))
}

#[wasm_bindgen]
pub fn erc721(address: String, token_id: String) -> Result<AssetId, JsValue> {
    let address = Address::from_str(&address)
        .map_err(|e| JsValue::from_str(&format!("Invalid ERC721 address: {e}")))?;
    let token_id: U256 = token_id
        .parse()
        .map_err(|e| JsValue::from_str(&format!("Invalid ERC721 token ID: {e}")))?;
    Ok(AssetId::Erc721(address, token_id))
}

#[wasm_bindgen]
pub fn erc1155(address: String, token_id: String) -> Result<AssetId, JsValue> {
    let address = Address::from_str(&address)
        .map_err(|e| JsValue::from_str(&format!("Invalid ERC1155 address: {e}")))?;
    let token_id: U256 = token_id
        .parse()
        .map_err(|e| JsValue::from_str(&format!("Invalid ERC1155 token ID: {e}")))?;
    Ok(AssetId::Erc1155(address, token_id))
}

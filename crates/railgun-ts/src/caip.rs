use std::str::FromStr;

use alloy::primitives::Address;
use railgun_rs::caip::AssetId;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

/// Create an ERC20 AssetId from an erc20 token address.
///
/// Throws an error if the address is invalid (e.g. not a valid hex string, not 20 bytes).
#[wasm_bindgen]
pub fn erc20(
    #[wasm_bindgen(unchecked_param_type = "`0x${string}`")] address: String,
) -> Result<AssetId, JsError> {
    let address = Address::from_str(&address).map_err(|e| JsError::new(&e.to_string()))?;
    Ok(AssetId::erc20(address))
}

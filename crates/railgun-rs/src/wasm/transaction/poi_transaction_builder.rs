use alloy_primitives::Address;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::{
    caip::AssetId,
    railgun::{address::RailgunAddress, transaction::PoiTransactionBuilder},
    wasm::JsSigner,
};

/// Builder for POI transact transactions (transfers and unshields)
#[wasm_bindgen]
pub struct JsPoiTransactionBuilder {
    pub(crate) inner: PoiTransactionBuilder,
}

#[wasm_bindgen]
impl JsPoiTransactionBuilder {
    /// Add a transfer operation.
    pub fn transfer(
        self,
        from: &JsSigner,
        to: RailgunAddress,
        asset: AssetId,
        value: u128,
        memo: Option<String>,
    ) -> Self {
        self.inner
            .transfer(from.inner(), to, asset, value, &memo.unwrap_or_default())
            .into()
    }

    /// Add an unshield operation.
    ///
    /// @param to: The EVM address to unshield to (0x1234...)
    pub fn unshield(
        self,
        from: &JsSigner,
        to: String,
        asset: AssetId,
        value: u128,
    ) -> Result<Self, JsError> {
        let to: Address = to
            .parse()
            .map_err(|e| JsError::new(&format!("Invalid to address: {}", e)))?;

        Ok(self
            .inner
            .set_unshield(from.inner(), to, asset, value)
            .into())
    }

    /// Add a native unshield operation (unwrap + ETH transfer via RelayAdapt).
    ///
    /// @param to: The EVM address to receive native ETH (0x1234...)
    #[wasm_bindgen(js_name = unshieldNative)]
    pub fn unshield_native(
        self,
        from: &JsSigner,
        to: String,
        value: u128,
    ) -> Result<Self, JsError> {
        let to: Address = to
            .parse()
            .map_err(|e| JsError::new(&format!("Invalid to address: {}", e)))?;

        Ok(self.inner.set_unshield_native(from.inner(), to, value).into())
    }
}

impl From<PoiTransactionBuilder> for JsPoiTransactionBuilder {
    fn from(inner: PoiTransactionBuilder) -> Self {
        Self { inner }
    }
}

use alloy::primitives::Address;
use railgun::{account::address::RailgunAddress, caip::AssetId, transact::TransactionBuilder};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::signer::JsRailgunSigner;

#[wasm_bindgen(js_name = "TransactionBuilder")]
pub struct JsTransactionBuilder {
    pub(crate) inner: TransactionBuilder,
}

#[wasm_bindgen(js_class = "TransactionBuilder")]
impl JsTransactionBuilder {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: TransactionBuilder::new(),
        }
    }

    /// Adds a transfer operation to this transaction.
    pub fn transfer(
        self,
        from: &JsRailgunSigner,
        to: &RailgunAddress,
        asset: &AssetId,
        value: u128,
        memo: String,
    ) -> Self {
        Self {
            inner: self
                .inner
                .transfer(from.inner(), to.clone(), asset.clone(), value, &memo),
        }
    }

    /// Adds an unshield operation to this transaction.
    pub fn unshield(
        self,
        from: &JsRailgunSigner,
        #[wasm_bindgen(unchecked_param_type = "`0x${string}`")] to: String,
        asset: &AssetId,
        value: u128,
    ) -> Result<Self, JsError> {
        let to = to
            .parse::<Address>()
            .map_err(|e| JsError::new(&e.to_string()))?;

        let inner = self
            .inner
            .unshield(from.inner(), to, asset.clone(), value)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Self { inner })
    }
}

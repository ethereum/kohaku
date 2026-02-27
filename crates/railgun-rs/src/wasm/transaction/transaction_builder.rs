use alloy::primitives::Address;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::{
    caip::AssetId,
    railgun::{address::RailgunAddress, transaction::TransactionBuilder},
    wasm::JsSigner,
};

/// Builder for transact transactions (transfers and unshields)
#[wasm_bindgen]
pub struct JsTransactionBuilder {
    inner: TransactionBuilder,
}

#[wasm_bindgen]
impl JsTransactionBuilder {
    /// Add a transfer operation.
    pub fn transfer(
        self,
        from: &JsSigner,
        to: RailgunAddress,
        asset: AssetId,
        value: u128,
        memo: &str,
    ) -> Self {
        self.inner
            .transfer(from.inner(), to, asset, value, memo)
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
}

impl From<TransactionBuilder> for JsTransactionBuilder {
    fn from(inner: TransactionBuilder) -> Self {
        Self { inner }
    }
}

impl From<JsTransactionBuilder> for TransactionBuilder {
    fn from(builder: JsTransactionBuilder) -> Self {
        builder.inner
    }
}

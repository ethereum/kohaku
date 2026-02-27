use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::{
    caip::AssetId,
    railgun::{address::RailgunAddress, transaction::ShieldBuilder},
    wasm::transaction::JsTxData,
};

/// Builder for shield transactions (self-broadcast only, no prover needed)
#[wasm_bindgen]
pub struct JsShieldBuilder {
    inner: ShieldBuilder,
}

#[wasm_bindgen]
impl JsShieldBuilder {
    /// Add a shield operation.
    pub fn shield(self, recipient: RailgunAddress, asset: AssetId, amount: u128) -> Self {
        JsShieldBuilder {
            inner: self.inner.shield(recipient, asset, amount),
        }
    }

    /// Build the shield transaction calldata
    pub fn build(self) -> Result<JsTxData, JsError> {
        let tx = self
            .inner
            .build(&mut rand::rng())
            .map_err(|e| JsError::new(&format!("Shield build error: {}", e)))?;

        Ok(tx.into())
    }
}

impl From<ShieldBuilder> for JsShieldBuilder {
    fn from(inner: ShieldBuilder) -> Self {
        Self { inner }
    }
}

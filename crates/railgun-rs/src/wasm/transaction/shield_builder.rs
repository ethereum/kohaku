use eth_rpc::TxData;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::{
    caip::AssetId,
    railgun::{address::RailgunAddress, transaction::ShieldBuilder},
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

    pub fn shield_native(self, recipient: RailgunAddress, amount: u128) -> Self {
        JsShieldBuilder {
            inner: self.inner.shield_native(recipient, amount),
        }
    }

    /// Build the shield transaction calldata
    pub fn build(self) -> Result<Vec<TxData>, JsError> {
        let txns = self
            .inner
            .build(&mut rand::rng())
            .map_err(|e| JsError::new(&format!("Shield build error: {}", e)))?;

        Ok(txns.into_iter().map(|txn| txn.into()).collect())
    }
}

impl From<ShieldBuilder> for JsShieldBuilder {
    fn from(inner: ShieldBuilder) -> Self {
        Self { inner }
    }
}

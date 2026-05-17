use eip_1193_provider::tx_data::TxData;
use railgun::{
    account::address::RailgunAddress, caip::AssetId, chain_config::ChainConfig,
    transact::ShieldBuilder,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen(js_name = "ShieldBuilder")]
pub struct JsShieldBuilder {
    pub(crate) inner: ShieldBuilder,
}

#[wasm_bindgen(js_class = "ShieldBuilder")]
impl JsShieldBuilder {
    #[wasm_bindgen(constructor)]
    pub fn new(chain: &ChainConfig) -> Self {
        Self {
            inner: ShieldBuilder::new(chain.clone()),
        }
    }

    /// Adds a shield operation to the transaction builder
    pub fn shield(self, recipient: &RailgunAddress, asset: &AssetId, value: u128) -> Self {
        Self {
            inner: self.inner.shield(recipient.clone(), asset.clone(), value),
        }
    }

    /// Adds a shield operation for a native asset to the transaction builder
    #[wasm_bindgen(js_name = "shieldNative")]
    pub fn shield_native(self, recipient: &RailgunAddress, value: u128) -> Self {
        Self {
            inner: self.inner.shield_native(recipient.clone(), value),
        }
    }

    /// Builds the shield transaction. Shield txns must be self-broadcast
    pub fn build(self) -> Result<Vec<TxData>, JsError> {
        let mut rng = rand::rng();
        self.inner
            .build(&mut rng)
            .map_err(|e| JsError::new(&e.to_string()))
    }
}

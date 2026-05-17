use std::sync::Arc;

use eip_1193_provider::js::JsEip1193Provider;
use railgun_rs::{builder::RailgunBuilder, chain_config::ChainConfig};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::provider::JsRailgunProvider;

#[wasm_bindgen(js_name = "RailgunBuilder")]
pub struct JsRailgunBuilder {
    inner: RailgunBuilder,
}

#[wasm_bindgen(js_class = "RailgunBuilder")]
impl JsRailgunBuilder {
    pub fn new(chain: ChainConfig, provider: JsEip1193Provider) -> Self {
        Self {
            inner: RailgunBuilder::new(chain, Arc::new(provider)),
        }
    }

    pub fn with_poi(mut self) -> Self {
        self.inner = self.inner.with_poi();
        self
    }

    pub async fn build(self) -> Result<JsRailgunProvider, JsError> {
        let inner = self
            .inner
            .build()
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;

        Ok(JsRailgunProvider::new(inner))
    }
}

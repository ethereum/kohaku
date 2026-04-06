use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    railgun::broadcaster::broadcaster::{Broadcaster, Fee},
    wasm::JsPoiProvedTx,
};

#[wasm_bindgen]
pub struct JsBroadcaster {
    pub(crate) inner: Broadcaster,
}

#[wasm_bindgen]
impl JsBroadcaster {
    #[wasm_bindgen(getter)]
    pub fn fee(&self) -> Fee {
        self.inner.fee.clone()
    }

    #[wasm_bindgen(getter, unchecked_return_type = "`0x${string}`")]
    pub fn address(&self) -> String {
        self.inner.address.to_string()
    }

    #[wasm_bindgen(unchecked_return_type = "`0x${string}`")]
    pub async fn broadcast(&self, tx: &JsPoiProvedTx) -> Result<String, JsValue> {
        let tx_hash = self
            .inner
            .broadcast(&tx.inner, &mut rand::rng())
            .await
            .map_err(|e| JsValue::from_str(&format!("Broadcast error: {}", e)))?;
        Ok(tx_hash.to_string())
    }
}

impl From<Broadcaster> for JsBroadcaster {
    fn from(inner: Broadcaster) -> Self {
        Self { inner }
    }
}

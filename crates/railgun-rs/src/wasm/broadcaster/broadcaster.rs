use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    railgun::broadcaster::broadcaster::Broadcaster,
    wasm::{JsPoiProvedTx, broadcaster::JsFee},
};

#[wasm_bindgen]
pub struct JsBroadcaster {
    pub(crate) inner: Broadcaster,
}

#[wasm_bindgen]
impl JsBroadcaster {
    pub fn fee(&self) -> JsFee {
        self.inner.fee.clone().into()
    }

    pub fn address(&self) -> String {
        self.inner.address.to_string()
    }

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

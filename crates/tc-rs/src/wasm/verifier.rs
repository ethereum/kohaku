use std::sync::Arc;

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    indexer::{RpcSyncer, Verifier},
    wasm::syncer::new_dyn_provider,
};

#[wasm_bindgen]
pub struct JsVerifier {
    inner: Arc<dyn Verifier>,
}

#[wasm_bindgen]
impl JsVerifier {
    #[wasm_bindgen(js_name = "newRpc")]
    pub async fn new_rpc(rpc_url: &str) -> Result<JsVerifier, JsValue> {
        let provider = new_dyn_provider(rpc_url).await?;
        Ok(RpcSyncer::new(provider).into())
    }
}

impl JsVerifier {
    pub fn inner(&self) -> Arc<dyn Verifier> {
        self.inner.clone()
    }
}

impl From<RpcSyncer> for JsVerifier {
    fn from(syncer: RpcSyncer) -> Self {
        JsVerifier {
            inner: Arc::new(syncer),
        }
    }
}

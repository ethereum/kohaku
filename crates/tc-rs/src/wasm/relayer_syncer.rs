use std::sync::Arc;

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    broadcaster::{RelayerSyncer, RpcRelayerSyncer},
    wasm::syncer::new_dyn_provider,
};

#[wasm_bindgen]
pub struct JsRelayerSyncer {
    inner: Arc<dyn RelayerSyncer>,
}

#[wasm_bindgen]
impl JsRelayerSyncer {
    /// Creates a new `JsRelayerSyncer` using an RPC URL.
    ///
    /// @param mainnetRpcUrl - An RPC URL for a mainnet RPC provider.
    #[wasm_bindgen(js_name = "newRpc")]
    pub async fn new_rpc(mainnet_rpc_url: &str) -> Result<JsRelayerSyncer, JsValue> {
        let provider = new_dyn_provider(mainnet_rpc_url).await?;
        Ok(RpcRelayerSyncer::new(provider).into())
    }
}

impl JsRelayerSyncer {
    pub fn inner(&self) -> Arc<dyn RelayerSyncer> {
        self.inner.clone()
    }
}

impl From<RpcRelayerSyncer> for JsRelayerSyncer {
    fn from(syncer: RpcRelayerSyncer) -> Self {
        JsRelayerSyncer {
            inner: Arc::new(syncer),
        }
    }
}

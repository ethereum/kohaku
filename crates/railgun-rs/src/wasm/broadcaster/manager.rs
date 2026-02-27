use tracing::warn;
use wasm_bindgen::prelude::wasm_bindgen;

use crate::{
    railgun::broadcaster::broadcaster_manager::BroadcasterManager,
    wasm::broadcaster::{
        broadcaster::JsBroadcaster,
        transport::{JsWakuAdapter, JsWakuTransport},
    },
};

#[wasm_bindgen]
pub struct JsBroadcasterManager {
    pub(crate) inner: BroadcasterManager,
}

#[wasm_bindgen]
impl JsBroadcasterManager {
    #[wasm_bindgen(constructor)]
    pub fn new(
        chain_id: u64,
        adapter: JsWakuAdapter,
        whitelisted_broadcasters: Vec<String>,
    ) -> Self {
        let transport = JsWakuTransport::new(adapter);
        let whitelisted = whitelisted_broadcasters
            .into_iter()
            .filter_map(|s| s.parse().ok())
            .collect();
        let inner = BroadcasterManager::new(chain_id, transport, whitelisted);
        Self { inner }
    }

    #[wasm_bindgen]
    pub fn start(&mut self) {
        let inner = self.inner.clone();
        wasm_bindgen_futures::spawn_local(async move {
            if let Err(e) = inner.start().await {
                warn!("BroadcasterManager error: {}", e);
            }
        });
    }

    #[wasm_bindgen]
    pub async fn best_broadcaster_for_token(
        &self,
        token_address: String,
        current_time: u64,
    ) -> Option<JsBroadcaster> {
        let token = token_address.parse().ok()?;
        self.inner
            .best_broadcaster_for_token(token, current_time)
            .await
            .map(Into::into)
    }
}

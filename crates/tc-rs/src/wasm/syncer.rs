use std::sync::Arc;

use alloy::{
    network::Ethereum,
    providers::{DynProvider, Provider, ProviderBuilder},
};
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::indexer::{CacheSyncer, ChainedSyncer, RpcSyncer, Syncer};

#[wasm_bindgen]
pub struct JsSyncer {
    inner: Arc<dyn Syncer>,
}

#[wasm_bindgen]
impl JsSyncer {
    #[wasm_bindgen(js_name = "newRpc")]
    pub async fn new_rpc(rpc_url: &str, batch_size: u64) -> Result<JsSyncer, JsValue> {
        let provider = new_dyn_provider(rpc_url).await?;
        Ok(RpcSyncer::new(provider).with_batch_size(batch_size).into())
    }

    #[wasm_bindgen(js_name = "newCache")]
    pub fn new_cache(cache_json: &str) -> Result<JsSyncer, JsValue> {
        CacheSyncer::from_str(cache_json)
            .map(Into::into)
            .map_err(|e| JsValue::from_str(&format!("Cache syncer error: {}", e)))
    }

    #[wasm_bindgen(js_name = "newChained")]
    pub fn new_chained(syncers: Vec<JsSyncer>) -> JsSyncer {
        ChainedSyncer::new(syncers.into_iter().map(|s| s.inner.clone()).collect()).into()
    }
}

impl JsSyncer {
    pub fn inner(&self) -> Arc<dyn Syncer> {
        self.inner.clone()
    }
}

impl From<RpcSyncer> for JsSyncer {
    fn from(syncer: RpcSyncer) -> Self {
        JsSyncer {
            inner: Arc::new(syncer),
        }
    }
}

impl From<CacheSyncer> for JsSyncer {
    fn from(syncer: CacheSyncer) -> Self {
        JsSyncer {
            inner: Arc::new(syncer),
        }
    }
}

impl From<ChainedSyncer> for JsSyncer {
    fn from(syncer: ChainedSyncer) -> Self {
        JsSyncer {
            inner: Arc::new(syncer),
        }
    }
}

pub async fn new_dyn_provider(rpc_url: &str) -> Result<DynProvider, JsValue> {
    let provider = ProviderBuilder::new()
        .network::<Ethereum>()
        .connect(rpc_url)
        .await
        .map_err(|e| JsValue::from_str(&format!("Failed to connect to RPC: {}", e)))?
        .erased();

    Ok(provider)
}

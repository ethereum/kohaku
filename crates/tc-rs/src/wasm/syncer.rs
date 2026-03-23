use std::sync::Arc;

use eth_rpc::JsEthRpcAdapter;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::indexer::{ChainedSyncer, RemoteSyncer, RpcSyncer, Syncer};

#[wasm_bindgen]
pub struct JsSyncer {
    inner: Arc<dyn Syncer>,
}

#[wasm_bindgen]
impl JsSyncer {
    #[wasm_bindgen(js_name = "newRpc")]
    pub async fn new_rpc(provider: JsEthRpcAdapter, batch_size: u64) -> Result<JsSyncer, JsValue> {
        Ok(RpcSyncer::new(Arc::new(provider))
            .with_batch_size(batch_size)
            .into())
    }

    #[wasm_bindgen(js_name = "newRemote")]
    pub fn new_remote(base_url: &str) -> JsSyncer {
        RemoteSyncer::new(base_url.to_string()).into()
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

impl From<RemoteSyncer> for JsSyncer {
    fn from(syncer: RemoteSyncer) -> Self {
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

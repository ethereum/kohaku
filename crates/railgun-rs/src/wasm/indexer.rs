use std::sync::Arc;

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    railgun::indexer::{ChainedSyncer, NoteSyncer, RpcSyncer, SubsquidSyncer},
    wasm::chain::{new_dyn_provider, try_get_chain},
};

#[wasm_bindgen]
pub struct JsSyncer {
    inner: Arc<dyn NoteSyncer>,
}

#[wasm_bindgen]
impl JsSyncer {
    #[wasm_bindgen(js_name = "newSubsquid")]
    pub fn new_subsquid(chain_id: u64) -> Result<JsSyncer, JsValue> {
        let chain = try_get_chain(chain_id)?;
        Ok(SubsquidSyncer::new(chain.subsquid_endpoint).into())
    }

    #[wasm_bindgen(js_name = "newRpc")]
    pub async fn new_rpc(
        rpc_url: &str,
        chain_id: u64,
        batch_size: u64,
    ) -> Result<JsSyncer, JsValue> {
        let chain = try_get_chain(chain_id)?;
        let provider = new_dyn_provider(rpc_url).await?;

        Ok(RpcSyncer::new(provider, chain)
            .with_batch_size(batch_size)
            .into())
    }

    #[wasm_bindgen(js_name = "newChained")]
    pub fn new_chained(syncers: Vec<JsSyncer>) -> JsSyncer {
        ChainedSyncer::new(syncers.into_iter().map(|s| s.inner.clone()).collect()).into()
    }
}

impl JsSyncer {
    pub fn inner(&self) -> Arc<dyn NoteSyncer> {
        self.inner.clone()
    }
}

impl From<SubsquidSyncer> for JsSyncer {
    fn from(syncer: SubsquidSyncer) -> Self {
        JsSyncer {
            inner: Arc::new(syncer),
        }
    }
}

impl From<RpcSyncer> for JsSyncer {
    fn from(syncer: RpcSyncer) -> Self {
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

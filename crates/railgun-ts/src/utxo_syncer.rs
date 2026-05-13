use std::sync::Arc;

use eip_1193_provider::js::JsEip1193Provider;
use railgun_rs::{
    chain_config::ChainConfig,
    railgun::indexer::{ChainedSyncer, NoteSyncer, RpcSyncer, SubsquidSyncer},
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(js_name = "NoteSyncer")]
pub struct JsNoteSyncer {
    pub(crate) inner: Arc<dyn NoteSyncer>,
}

#[wasm_bindgen]
impl JsNoteSyncer {
    #[wasm_bindgen(js_name = "subsquid")]
    pub fn new_subsquid(chain: ChainConfig) -> Self {
        Self {
            inner: SubsquidSyncer::new(chain.subsquid_endpoint).erased(),
        }
    }

    #[wasm_bindgen(js_name = "rpc")]
    pub fn new_rpc(chain: ChainConfig, provider: JsEip1193Provider, batch_size: u64) -> Self {
        Self {
            inner: RpcSyncer::new(chain, Arc::new(provider))
                .with_batch_size(batch_size)
                .erased(),
        }
    }

    #[wasm_bindgen(js_name = "chained")]
    pub fn new_chained(syncers: Vec<JsNoteSyncer>) -> Self {
        Self {
            inner: ChainedSyncer::new(syncers.into_iter().map(|s| s.inner.clone()).collect())
                .erased(),
        }
    }
}

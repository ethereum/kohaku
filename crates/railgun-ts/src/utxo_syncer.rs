use std::sync::Arc;

use eip_1193_provider::js::JsEip1193Provider;
use railgun_rs::{
    chain_config::ChainConfig,
    indexer::syncer::{ChainedSyncer, RpcSyncer, SubsquidSyncer, UtxoSyncer},
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(js_name = "NoteSyncer")]
pub struct JsNoteSyncer {
    pub(crate) inner: Arc<dyn UtxoSyncer>,
}

#[wasm_bindgen(js_class = "NoteSyncer")]
impl JsNoteSyncer {
    #[wasm_bindgen(js_name = "subsquid")]
    pub fn new_subsquid(chain: &ChainConfig) -> Self {
        Self {
            inner: Arc::new(SubsquidSyncer::new(chain.subsquid_endpoint.clone())),
        }
    }

    #[wasm_bindgen(js_name = "rpc")]
    pub fn new_rpc(chain: &ChainConfig, provider: JsEip1193Provider, batch_size: u64) -> Self {
        Self {
            inner: Arc::new(
                RpcSyncer::new(chain.clone(), Arc::new(provider)).with_batch_size(batch_size),
            ),
        }
    }

    #[wasm_bindgen(js_name = "chained")]
    pub fn new_chained(syncers: Vec<JsNoteSyncer>) -> Self {
        let mut chained = ChainedSyncer::new();
        for syncer in &syncers {
            chained = chained.then_arc(syncer.inner.clone());
        }

        Self {
            inner: Arc::new(chained),
        }
    }
}

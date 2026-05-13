use std::sync::Arc;

use railgun_rs::{
    chain_config::ChainConfig,
    railgun::indexer::{SubsquidSyncer, TransactionSyncer},
};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen(js_name = "TxidSyncer")]
pub struct JsTxidSyncer {
    pub(crate) inner: Arc<dyn TransactionSyncer>,
}

#[wasm_bindgen]
impl JsTxidSyncer {
    #[wasm_bindgen(js_name = "subsquid")]
    pub fn new_subsquid(chain: ChainConfig) -> Self {
        Self {
            inner: SubsquidSyncer::new(chain.subsquid_endpoint).erased(),
        }
    }
}

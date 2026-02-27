use wasm_bindgen::prelude::wasm_bindgen;

use crate::{broadcaster::PreparedBroadcast, wasm::JsPool};

#[wasm_bindgen]
pub struct JsPreparedBroadcast {
    pub(crate) inner: PreparedBroadcast,
}

#[wasm_bindgen]
impl JsPreparedBroadcast {
    #[wasm_bindgen(getter)]
    pub fn pool(&self) -> JsPool {
        self.inner.pool.clone().into()
    }

    #[wasm_bindgen(getter)]
    pub fn hostname(&self) -> String {
        self.inner.hostname.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn display(&self) -> String {
        format!("PreparedBroadcast({:?})", self.inner)
    }
}

impl From<PreparedBroadcast> for JsPreparedBroadcast {
    fn from(inner: PreparedBroadcast) -> Self {
        Self { inner }
    }
}

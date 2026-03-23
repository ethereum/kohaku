use wasm_bindgen::prelude::wasm_bindgen;

use crate::{relayers::PreparedTransaction, wasm::JsPool};

#[wasm_bindgen]
pub struct JsPreparedTransaction {
    pub(crate) inner: PreparedTransaction,
}

#[wasm_bindgen]
impl JsPreparedTransaction {
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
        format!("PreparedTransaction({:?})", self.inner)
    }
}

impl From<PreparedTransaction> for JsPreparedTransaction {
    fn from(inner: PreparedTransaction) -> Self {
        Self { inner }
    }
}

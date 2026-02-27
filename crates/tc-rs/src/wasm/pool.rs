use wasm_bindgen::prelude::wasm_bindgen;

use crate::Pool;

#[wasm_bindgen]
pub struct JsPool {
    pub(crate) inner: Pool,
}

#[wasm_bindgen]
impl JsPool {
    #[wasm_bindgen(getter)]
    pub fn address(&self) -> String {
        format!("{:?}", self.inner.address)
    }

    #[wasm_bindgen(getter, js_name = "chainId")]
    pub fn chain_id(&self) -> u64 {
        self.inner.chain_id
    }

    #[wasm_bindgen(getter)]
    pub fn symbol(&self) -> String {
        self.inner.symbol()
    }

    #[wasm_bindgen(getter)]
    pub fn amount(&self) -> String {
        self.inner.amount()
    }

    #[wasm_bindgen(js_name = "sepoliaEther1", getter)]
    pub fn sepolia_ether_1() -> JsPool {
        Pool::sepolia_ether_1().into()
    }

    #[wasm_bindgen(js_name = "ethereumEther100", getter)]
    pub fn ethereum_ether_100() -> JsPool {
        Pool::ethereum_ether_100().into()
    }
}

impl From<Pool> for JsPool {
    fn from(pool: Pool) -> Self {
        JsPool { inner: pool }
    }
}

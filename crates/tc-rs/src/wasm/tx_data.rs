use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::tx_data::TxData;

#[wasm_bindgen]
#[derive(Clone)]
pub struct JsTxData {
    inner: TxData,
}

#[wasm_bindgen]
impl JsTxData {
    #[wasm_bindgen(getter)]
    pub fn to(&self) -> String {
        format!("{}", self.inner.to)
    }

    #[wasm_bindgen(getter, js_name = "dataHex")]
    pub fn data_hex(&self) -> String {
        format!("0x{}", hex::encode(&self.inner.data))
    }

    #[wasm_bindgen(getter)]
    pub fn value(&self) -> js_sys::BigInt {
        let s = self.inner.value.to_string();
        js_sys::BigInt::new(&JsValue::from_str(&s)).unwrap_or_else(|_| js_sys::BigInt::from(0u64))
    }
}

impl From<TxData> for JsTxData {
    fn from(inner: TxData) -> Self {
        JsTxData { inner }
    }
}

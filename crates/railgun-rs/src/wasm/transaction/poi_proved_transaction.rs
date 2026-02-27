use std::str::FromStr;

use wasm_bindgen::prelude::wasm_bindgen;

use crate::railgun::transaction::PoiProvedTx;

/// POI proved transaction
#[wasm_bindgen]
pub struct JsPoiProvedTx {
    pub(crate) inner: PoiProvedTx,
}

#[wasm_bindgen]
impl JsPoiProvedTx {
    /// Contract address to call (0x...)
    #[wasm_bindgen(getter)]
    pub fn to(&self) -> String {
        self.inner.tx_data.to.to_checksum(None)
    }

    /// Raw calldata bytes
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Vec<u8> {
        self.inner.tx_data.data.clone()
    }

    /// Returns 0x-prefixed hex-encoded calldata
    #[wasm_bindgen(getter, js_name = "dataHex")]
    pub fn data_hex(&self) -> String {
        format!("0x{}", hex::encode(&self.inner.tx_data.data))
    }

    /// ETH value to send
    #[wasm_bindgen(getter)]
    pub fn value(&self) -> js_sys::BigInt {
        js_sys::BigInt::from_str(&self.inner.tx_data.value.to_string()).unwrap()
    }
}

impl From<PoiProvedTx> for JsPoiProvedTx {
    fn from(inner: PoiProvedTx) -> Self {
        Self { inner }
    }
}

use std::str::FromStr;

use eth_rpc::TxData;
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
    #[wasm_bindgen(getter, unchecked_return_type = "`0x${string}`")]
    pub fn to(&self) -> String {
        self.inner.tx_data.to.to_checksum(None)
    }

    /// Raw calldata bytes
    #[wasm_bindgen(getter, unchecked_return_type = "`0x${string}`")]
    pub fn data(&self) -> String {
        self.inner.tx_data.data.clone().to_string()
    }

    /// ETH value to send
    #[wasm_bindgen(getter)]
    pub fn value(&self) -> js_sys::BigInt {
        js_sys::BigInt::from_str(&self.inner.tx_data.value.to_string()).unwrap()
    }

    /// Full transaction data (to, data, value) as a TxData object
    #[wasm_bindgen(js_name = "txData")]
    pub fn tx_data(&self) -> TxData {
        self.inner.tx_data.clone()
    }
}

impl From<PoiProvedTx> for JsPoiProvedTx {
    fn from(inner: PoiProvedTx) -> Self {
        Self { inner }
    }
}

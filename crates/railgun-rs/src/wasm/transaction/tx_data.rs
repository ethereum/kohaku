use std::str::FromStr;

use wasm_bindgen::prelude::wasm_bindgen;

use crate::railgun::transaction::TxData;

/// Transaction data output for EVM submission
#[wasm_bindgen]
pub struct JsTxData {
    inner: TxData,
}

#[wasm_bindgen]
impl JsTxData {
    /// Contract address to call (0x...)
    #[wasm_bindgen(getter)]
    pub fn to(&self) -> String {
        self.inner.to.to_checksum(None)
    }

    /// Raw calldata bytes
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Vec<u8> {
        self.inner.data.clone()
    }

    /// Returns 0x-prefixed hex-encoded calldata
    #[wasm_bindgen(getter, js_name = "dataHex")]
    pub fn data_hex(&self) -> String {
        format!("0x{}", hex::encode(&self.inner.data))
    }

    /// ETH value to send
    #[wasm_bindgen(getter)]
    pub fn value(&self) -> js_sys::BigInt {
        js_sys::BigInt::from_str(&self.inner.value.to_string()).unwrap()
    }
}

impl From<TxData> for JsTxData {
    fn from(tx_data: TxData) -> Self {
        JsTxData { inner: tx_data }
    }
}

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
    /// Full transaction data (to, data, value, etc.)
    #[wasm_bindgen(getter, js_name = "tx")]
    pub fn tx(&self) -> TxData {
        self.inner.tx_data.clone()
    }

    /// Minimum gas price for this transaction, in gwei.
    #[wasm_bindgen(getter, js_name = "minGasPrice")]
    pub fn min_gas_price(&self) -> u128 {
        self.inner.min_gas_price
    }
}

impl From<PoiProvedTx> for JsPoiProvedTx {
    fn from(inner: PoiProvedTx) -> Self {
        Self { inner }
    }
}

use std::collections::HashMap;

use wasm_bindgen::prelude::wasm_bindgen;

use crate::caip::AssetId;

#[wasm_bindgen]
pub struct JsBalance {
    pub(crate) inner: HashMap<AssetId, u128>,
}

#[wasm_bindgen]
pub struct JsBalanceEntry {
    pub asset_id: AssetId,
    pub balance: u128,
}

#[wasm_bindgen]
impl JsBalance {
    pub fn get(&self, asset_id: &AssetId) -> Option<js_sys::BigInt> {
        self.inner
            .get(asset_id)
            .map(|balance| js_sys::BigInt::from(*balance))
    }

    pub fn entries(&self) -> Vec<JsBalanceEntry> {
        self.inner
            .iter()
            .map(|(asset_id, balance)| JsBalanceEntry {
                asset_id: asset_id.clone(),
                balance: *balance,
            })
            .collect()
    }
}

impl From<HashMap<AssetId, u128>> for JsBalance {
    fn from(inner: HashMap<AssetId, u128>) -> Self {
        JsBalance { inner }
    }
}

use std::collections::HashMap;

use wasm_bindgen::prelude::wasm_bindgen;

use crate::{caip::AssetId, railgun::poi::PoiStatus};

#[wasm_bindgen]
pub struct JsPoiBalance {
    pub(crate) inner: HashMap<(PoiStatus, AssetId), u128>,
}

#[wasm_bindgen]
pub struct JsPoiBalanceEntry {
    pub poi_status: PoiStatus,
    pub asset_id: AssetId,
    pub balance: u128,
}

#[wasm_bindgen]
impl JsPoiBalance {
    pub fn get(&self, poi_status: &PoiStatus, asset_id: &AssetId) -> Option<js_sys::BigInt> {
        let bal = self
            .inner
            .get(&(poi_status.clone(), asset_id.clone()))
            .map(|balance| js_sys::BigInt::from(*balance))
            .unwrap_or_default();

        Some(bal)
    }

    pub fn entries(&self) -> Vec<JsPoiBalanceEntry> {
        self.inner
            .iter()
            .map(|((poi_status, asset_id), balance)| JsPoiBalanceEntry {
                poi_status: poi_status.clone(),
                asset_id: asset_id.clone(),
                balance: *balance,
            })
            .collect()
    }
}

impl From<HashMap<(PoiStatus, AssetId), u128>> for JsPoiBalance {
    fn from(inner: HashMap<(PoiStatus, AssetId), u128>) -> Self {
        JsPoiBalance { inner }
    }
}

use serde::{Deserialize, Serialize};

use crate::{caip::AssetId, railgun::poi::PoiStatus};

#[derive(Debug, Clone, Serialize, Deserialize, tsify::Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsPoiBalance {
    pub poi_status: PoiStatus,
    pub asset_id: AssetId,
    pub balance: u128,
}

use serde::{Deserialize, Serialize};

use crate::caip::AssetId;

#[derive(Debug, Clone, Serialize, Deserialize, tsify::Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsBalanceEntry {
    pub asset_id: AssetId,
    #[tsify(type = "bigint")]
    pub balance: u128,
}

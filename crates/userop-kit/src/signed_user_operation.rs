use alloy::primitives::Address;
use serde::{Deserialize, Serialize};

use crate::user_operation::UserOperation;

/// A signed 4337 UserOperation with an optional signed 7702 Authorization
/// ready to be sent to a bundler.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "camelCase")]
pub struct SignedUserOperation {
    pub user_op: UserOperation,
    pub entry_point: Address,
}

use alloy::{
    primitives::{Address, B256, Bytes, U256},
    rpc::types::{Log, ReceiptWithBloom, TransactionReceipt},
};
use serde::{Deserialize, Serialize};

/// ERC-4337 UserOperation in unpacked JSON-RPC wire format.
///
/// EntryPoint 0.7 & 0.8
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "camelCase")]
pub struct UserOperation {
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub sender: Address,

    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub nonce: U256,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub factory: Option<Address>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub factory_data: Option<Bytes>,

    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub call_data: Bytes,

    #[serde(with = "alloy::serde::quantity")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub call_gas_limit: u128,

    #[serde(with = "alloy::serde::quantity")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub verification_gas_limit: u128,

    #[serde(with = "alloy::serde::quantity")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub pre_verification_gas: u128,

    #[serde(with = "alloy::serde::quantity")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub max_fee_per_gas: u128,

    #[serde(with = "alloy::serde::quantity")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub max_priority_fee_per_gas: u128,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub paymaster: Option<Address>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "alloy::serde::quantity::opt"
    )]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub paymaster_verification_gas_limit: Option<u128>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "alloy::serde::quantity::opt"
    )]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub paymaster_post_op_gas_limit: Option<u128>,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub paymaster_data: Option<Bytes>,

    #[serde(
        rename = "eip7702Auth",
        default,
        skip_serializing_if = "Authorization::is_none"
    )]
    pub authorization: Authorization,

    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub signature: Bytes,
}

/// Eip-7702 authorization
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Authorization {
    #[default]
    None,
    SignedEip7702(alloy::eips::eip7702::SignedAuthorization),
    Eip7702(alloy::eips::eip7702::Authorization),
}

impl Authorization {
    fn is_none(&self) -> bool {
        matches!(self, Authorization::None)
    }
}

/// A submitted user operation hash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi, type = "`0x${string}`"))]
pub struct UserOperationHash(pub B256);

/// Gas estimates returned by `eth_estimateUserOperationGas`.
///
/// EntryPoint 0.7 & 0.8
#[derive(Debug, Copy, Clone, Serialize, Deserialize)]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "camelCase")]
pub struct UserOperationGasEstimate {
    #[serde(with = "alloy::serde::quantity")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub pre_verification_gas: u128,

    #[serde(with = "alloy::serde::quantity")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub verification_gas_limit: u128,

    #[serde(with = "alloy::serde::quantity")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub call_gas_limit: u128,

    #[serde(default, with = "alloy::serde::quantity::opt")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub paymaster_verification_gas_limit: Option<u128>,

    #[serde(default, with = "alloy::serde::quantity::opt")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub paymaster_post_op_gas_limit: Option<u128>,
}

/// Receipt returned by `eth_getUserOperationReceipt`.
///
/// EntryPoint 0.7 & 0.8
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "camelCase")]
pub struct UserOperationReceipt {
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub entry_point: Address,

    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub user_op_hash: B256,

    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub sender: Address,

    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub nonce: U256,

    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub actual_gas_used: U256,

    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub actual_gas_cost: U256,

    pub success: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub reason: Option<Bytes>,
    pub logs: Vec<Log>,
    pub receipt: TransactionReceipt<ReceiptWithBloom>,
}

impl UserOperation {
    /// Returns the total gas limit for this UserOperation, including paymaster gas limits if
    /// applicable.
    pub fn total_gas_limit(&self) -> u128 {
        let mut total =
            self.pre_verification_gas + self.verification_gas_limit + self.call_gas_limit;
        if let Some(paymaster_verification_gas_limit) = self.paymaster_verification_gas_limit {
            total += paymaster_verification_gas_limit;
        }
        if let Some(paymaster_post_op_gas_limit) = self.paymaster_post_op_gas_limit {
            total += paymaster_post_op_gas_limit;
        }
        total
    }
}

use alloy_primitives::{Address, B256, Bytes, U256};
use alloy_rpc_types::SignedAuthorization;
use serde::{Deserialize, Serialize};

/// ERC-4337 0.7 & 0.8 UserOperation in unpacked JSON-RPC wire format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(target_arch = "wasm32", derive(tsify::Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "camelCase")]
pub struct UserOperation {
    pub sender: Address,

    pub nonce: U256,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub factory: Option<Address>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub factory_data: Option<Bytes>,

    pub call_data: Bytes,

    #[serde(with = "alloy_serde::quantity")]
    pub call_gas_limit: u128,

    #[serde(with = "alloy_serde::quantity")]
    pub verification_gas_limit: u128,

    #[serde(with = "alloy_serde::quantity")]
    pub pre_verification_gas: u128,

    #[serde(with = "alloy_serde::quantity")]
    pub max_fee_per_gas: u128,

    #[serde(with = "alloy_serde::quantity")]
    pub max_priority_fee_per_gas: u128,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub paymaster: Option<Address>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "alloy_serde::quantity::opt"
    )]
    pub paymaster_verification_gas_limit: Option<u128>,

    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        with = "alloy_serde::quantity::opt"
    )]
    pub paymaster_post_op_gas_limit: Option<u128>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub paymaster_data: Option<Bytes>,

    pub signature: Bytes,

    #[serde(rename = "eip7702Auth", skip_serializing_if = "Option::is_none")]
    pub authorization: Option<SignedAuthorization>,
}

/// A submitted user operation hash.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(target_arch = "wasm32", derive(tsify::Tsify))]
#[cfg_attr(target_arch = "wasm32", tsify(into_wasm_abi, from_wasm_abi))]
pub struct UserOperationHash(pub B256);

use alloy::{
    primitives::{Address, Bytes, U256},
    sol,
};
use serde::{Deserialize, Serialize};

use crate::user_operation::UserOperation;

sol! {
    contract EntryPoint {
        function getNonce(address sender, uint192 key) external view returns (uint256 nonce);
    }

    #[derive(Debug, Serialize, Deserialize)]
    /// The "packed" version of the 4337 UserOperation
    ///
    /// See the 0.8.0 EntryPoint impl for format details:
    /// <https://etherscan.io/address/0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108#code#F30#L1>
    struct PackedUserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        bytes32 accountGasLimits;
        uint256 preVerificationGas;
        bytes32 gasFees;
        bytes paymasterAndData;
    }
}

impl From<&UserOperation> for PackedUserOperation {
    fn from(op: &UserOperation) -> Self {
        let account_gas_limits = pack_u256(op.verification_gas_limit, op.call_gas_limit).into();
        let gas_fees = pack_u256(op.max_priority_fee_per_gas, op.max_fee_per_gas).into();
        let init_code = pack_init_code(op.factory, op.factory_data.clone());
        let paymaster_and_data = pack_paymaster_and_data(
            op.paymaster,
            op.paymaster_verification_gas_limit,
            op.paymaster_post_op_gas_limit,
            op.paymaster_data.clone(),
        );

        PackedUserOperation {
            sender: op.sender,
            nonce: op.nonce,
            initCode: init_code,
            callData: op.call_data.clone(),
            accountGasLimits: account_gas_limits,
            preVerificationGas: U256::from(op.pre_verification_gas),
            gasFees: gas_fees,
            paymasterAndData: paymaster_and_data,
        }
    }
}

/// Packs two u128 values into a single U256
fn pack_u256(a: u128, b: u128) -> U256 {
    let a = U256::from(a);
    let b = U256::from(b);
    (a << 128) | b
}

/// Pack the factory address and calldata into the initCode field.
fn pack_init_code(factory: Option<Address>, factory_data: Option<Bytes>) -> Bytes {
    let (Some(factory), Some(factory_data)) = (factory, factory_data) else {
        return Bytes::new();
    };

    let mut init_code = Vec::new();
    init_code.extend_from_slice(factory.as_slice());
    init_code.extend_from_slice(&factory_data);
    init_code.into()
}

/// Pack the paymaster address, gas limits, and calldata into the paymasterAndData field.
fn pack_paymaster_and_data(
    paymaster: Option<Address>,
    verification_gas_limit: Option<u128>,
    post_op_gas_limit: Option<u128>,
    paymaster_data: Option<Bytes>,
) -> Bytes {
    let (
        Some(paymaster),
        Some(verification_gas_limit),
        Some(post_op_gas_limit),
        Some(paymaster_data),
    ) = (
        paymaster,
        verification_gas_limit,
        post_op_gas_limit,
        paymaster_data,
    )
    else {
        return Bytes::new();
    };

    let mut data = Vec::new();
    data.extend_from_slice(paymaster.as_slice());
    data.extend_from_slice(&verification_gas_limit.to_be_bytes());
    data.extend_from_slice(&post_op_gas_limit.to_be_bytes());
    data.extend_from_slice(&paymaster_data);
    data.into()
}

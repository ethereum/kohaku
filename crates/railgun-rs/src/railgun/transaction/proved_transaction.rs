use alloy::{
    primitives::{Address, U256},
    sol_types::SolCall,
};
use eip_1193_provider::TxData;

use crate::{
    abis::{self, railgun::RailgunSmartWallet},
    circuit::inputs::TransactCircuitInputs,
    railgun::note::operation::Operation,
};

/// A transaction that has been proven for railgun.
pub struct ProvedTx {
    /// Transaction data to execute this transaction on-chain in railgun.
    pub tx_data: TxData,
    /// The operations included in this transaction alongside their proof data.
    pub proved_operations: Vec<ProvedOperation>,
}

/// A single proved operation.
pub struct ProvedOperation {
    pub inner: Operation,
    pub circuit_inputs: TransactCircuitInputs,
    pub transaction: abis::railgun::Transaction,
}

impl ProvedTx {
    pub fn new(railgun_smart_wallet: Address, operations: Vec<ProvedOperation>) -> Self {
        let transactions = operations.iter().map(|op| op.transaction.clone()).collect();
        let calldata = RailgunSmartWallet::transactCall {
            _transactions: transactions,
        }
        .abi_encode();
        let tx_data = TxData::new(railgun_smart_wallet, calldata.into(), U256::ZERO);
        Self {
            tx_data,
            proved_operations: operations,
        }
    }
}

impl ProvedOperation {
    pub fn new(
        operation: Operation,
        circuit_inputs: TransactCircuitInputs,
        transaction: abis::railgun::Transaction,
    ) -> Self {
        Self {
            inner: operation,
            circuit_inputs,
            transaction,
        }
    }
}

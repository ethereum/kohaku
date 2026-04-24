use alloy_primitives::{Address, U256};
use alloy_sol_types::SolCall;
use eth_rpc::TxData;

use crate::{
    abis::{self, railgun::RailgunSmartWallet},
    circuit::inputs::TransactCircuitInputs,
    railgun::note::{operation::Operation, utxo::UtxoNote},
};

/// A transaction that has been proven for railgun.
pub struct ProvedTx<N = UtxoNote> {
    /// Transaction data to execute this transaction on-chain in railgun.
    pub tx_data: TxData,
    /// The operations included in this transaction alongside their proof data.
    pub proved_operations: Vec<ProvedOperation<N>>,
}

/// A single proved operation.
pub struct ProvedOperation<N = UtxoNote> {
    pub operation: Operation<N>,
    pub circuit_inputs: TransactCircuitInputs,
    pub transaction: abis::railgun::Transaction,
}

impl<N> ProvedTx<N> {
    pub fn new(railgun_smart_wallet: Address, operations: Vec<ProvedOperation<N>>) -> Self {
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

impl<N> ProvedOperation<N> {
    pub fn new(
        operation: Operation<N>,
        circuit_inputs: TransactCircuitInputs,
        transaction: abis::railgun::Transaction,
    ) -> Self {
        Self {
            operation,
            circuit_inputs,
            transaction,
        }
    }
}

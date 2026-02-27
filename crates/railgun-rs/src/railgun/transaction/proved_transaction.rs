use std::fmt::Display;

use crate::{
    abis,
    circuit::inputs::TransactCircuitInputs,
    railgun::{
        note::{operation::Operation, utxo::UtxoNote},
        transaction::tx_data::TxData,
    },
};

/// A transaction that has been proven for railgun.
pub struct ProvedTx<N = UtxoNote> {
    /// Transaction data to execute this transaction on-chain in railgun.
    pub tx_data: TxData,
    /// The operations included in this transaction alongside their proof data.
    pub proved_operations: Vec<ProvedOperation<N>>,
    pub min_gas_price: u128,
}

/// A single proved operation.
pub struct ProvedOperation<N = UtxoNote> {
    pub operation: Operation<N>,
    pub circuit_inputs: TransactCircuitInputs,
    pub transaction: abis::railgun::Transaction,
}

impl Display for ProvedOperation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "ProvedOperation({})", self.operation)
    }
}

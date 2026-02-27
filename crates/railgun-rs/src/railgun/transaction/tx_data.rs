use alloy::{
    primitives::{Address, U256},
    rpc::types::TransactionRequest,
};
use alloy_sol_types::SolCall;

use crate::abis::railgun::{RailgunSmartWallet, Transaction};

// TODO: Update me to have a `send` method that sends the tx using a DynProvider
#[derive(Debug, Clone)]
pub struct TxData {
    pub to: Address,
    pub data: Vec<u8>,
    pub value: U256,
}

impl TxData {
    pub fn new(to: Address, data: Vec<u8>, value: U256) -> Self {
        TxData { to, data, value }
    }

    pub fn from_transactions(to: Address, transactions: Vec<Transaction>) -> Self {
        let call = RailgunSmartWallet::transactCall {
            _transactions: transactions,
        };
        let calldata = call.abi_encode();

        TxData {
            to,
            data: calldata,
            value: U256::ZERO,
        }
    }
}

impl From<TxData> for TransactionRequest {
    fn from(tx_data: TxData) -> Self {
        TransactionRequest::default()
            .to(tx_data.to)
            .input(tx_data.data.into())
            .value(tx_data.value)
    }
}

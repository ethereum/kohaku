use alloy::{
    primitives::{Address, U256},
    rpc::types::TransactionRequest,
};

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
}

impl From<TxData> for TransactionRequest {
    fn from(tx_data: TxData) -> Self {
        TransactionRequest::default()
            .to(tx_data.to)
            .input(tx_data.data.into())
            .value(tx_data.value)
    }
}

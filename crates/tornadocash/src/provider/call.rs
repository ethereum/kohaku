use alloy::{
    network::TransactionBuilder,
    primitives::{Address, Bytes, U256},
    rpc::types::TransactionRequest,
};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Call {
    pub target: Address,
    pub data: Bytes,
    pub value: U256,
}

impl Call {
    pub fn new(target: Address, data: Bytes, value: U256) -> Self {
        Self {
            target,
            data,
            value,
        }
    }
}

impl From<Call> for TransactionRequest {
    fn from(call: Call) -> Self {
        TransactionRequest::default()
            .with_to(call.target)
            .with_value(call.value)
            .input(call.data.into())
    }
}

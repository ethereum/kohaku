use std::collections::HashMap;

use alloy::primitives::U256;
use websnark_rs::circuit::Value;

pub struct CircuitInputs {
    root: U256,
    nullifier_hash: U256,
    recipient: U256,
    relayer: U256,
    fee: U256,
    refund: U256,
    nullifier: U256,
    secret: U256,
    path_elements: [U256; 20],
    path_indices: [U256; 20],
}

impl CircuitInputs {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        root: U256,
        nullifier_hash: U256,
        recipient: U256,
        relayer: U256,
        fee: U256,
        refund: U256,
        nullifier: U256,
        secret: U256,
        path_elements: [U256; 20],
        path_indices: [U256; 20],
    ) -> Self {
        Self {
            root,
            nullifier_hash,
            recipient,
            relayer,
            fee,
            refund,
            nullifier,
            secret,
            path_elements,
            path_indices,
        }
    }

    /// Convert the circuit inputs into a circuit input signal map
    pub fn as_signals(&self) -> HashMap<String, Value> {
        HashMap::from([
            ("root".into(), to_value(self.root)),
            ("nullifierHash".into(), to_value(self.nullifier_hash)),
            ("recipient".into(), to_value(self.recipient)),
            ("relayer".into(), to_value(self.relayer)),
            ("fee".into(), to_value(self.fee)),
            ("refund".into(), to_value(self.refund)),
            ("nullifier".into(), to_value(self.nullifier)),
            ("secret".into(), to_value(self.secret)),
            ("pathElements".into(), to_value_arr(&self.path_elements)),
            ("pathIndices".into(), to_value_arr(&self.path_indices)),
        ])
    }
}

fn to_value(value: U256) -> Value {
    Value::Number(value.into())
}

fn to_value_arr(values: &[U256]) -> Value {
    Value::Array(values.iter().map(|v| to_value(*v)).collect())
}

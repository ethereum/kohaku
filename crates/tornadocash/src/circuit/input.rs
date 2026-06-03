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
    pub fn as_signals(self) -> HashMap<String, Value> {
        let mut map = HashMap::new();
        map.insert("root".to_string(), Value::Number(self.root.into()));
        map.insert(
            "nullifierHash".to_string(),
            Value::Number(self.nullifier_hash.into()),
        );
        map.insert(
            "recipient".to_string(),
            Value::Number(self.recipient.into()),
        );
        map.insert("relayer".to_string(), Value::Number(self.relayer.into()));
        map.insert("fee".to_string(), Value::Number(self.fee.into()));
        map.insert("refund".to_string(), Value::Number(self.refund.into()));
        map.insert(
            "nullifier".to_string(),
            Value::Number(self.nullifier.into()),
        );
        map.insert("secret".to_string(), Value::Number(self.secret.into()));
        map.insert(
            "pathElements".to_string(),
            Value::Array(
                self.path_elements
                    .into_iter()
                    .map(|e| Value::Number(e.into()))
                    .collect(),
            ),
        );
        map.insert(
            "pathIndices".to_string(),
            Value::Array(
                self.path_indices
                    .into_iter()
                    .map(|e| Value::Number(e.into()))
                    .collect(),
            ),
        );
        map
    }
}

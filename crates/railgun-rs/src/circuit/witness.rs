use std::collections::HashMap;

use ruint::aliases::U256;

#[async_trait::async_trait]
pub trait WitnessCalculator {
    async fn calculate_witness(
        &self,
        circuit_type: CircuitType,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<Vec<U256>, String>;
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
pub enum CircuitType {
    Transact {
        nullifiers: usize,
        commitments: usize,
    },
    Poi {
        nullifiers: usize,
        commitments: usize,
    },
}

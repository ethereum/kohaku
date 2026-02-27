use std::collections::HashMap;

use ruint::aliases::U256;
use thiserror::Error;

use crate::Proof;

#[derive(Debug, Error)]
pub enum ProverError {
    #[error("Invalid circuit name: {0}")]
    InvalidCircuit(String),
    #[error("Witness generation failed: {0}")]
    WitnessGeneration(String),
    #[error("Error: {0}")]
    Other(String),
}

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
pub trait Prover {
    async fn prove(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<(Proof, Vec<U256>), ProverError>;
}

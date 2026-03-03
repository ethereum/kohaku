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
    #[error("Invalid proof: {0}")]
    InvalidProof(String),
    #[error("Error: {0}")]
    Other(String),
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait Prover: common::MaybeSend {
    async fn prove(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<(Proof, Vec<U256>), ProverError>;
}

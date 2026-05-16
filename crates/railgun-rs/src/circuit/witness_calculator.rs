use std::collections::HashMap;

use num_bigint::BigInt;
use ruint::aliases::U256;
use thiserror::Error;
use tracing::info;
use wasmer::{Module, Store};

use crate::circuit::artifact_loader::ArtifactLoader;

#[derive(Debug, Error)]
pub enum WitnessCalculatorError {
    #[error("Artifact loader error: {0}")]
    ArtifactLoaderError(#[source] Box<dyn std::error::Error + Send + Sync + 'static>),
    #[error("Compiler error: {0}")]
    CompilerError(#[from] wasmer::CompileError),
    #[error("Circom error: {0}")]
    CircomError(String),
}

pub async fn calculate_witness(
    artifact_loader: &dyn ArtifactLoader,
    circuit_name: &str,
    inputs: HashMap<String, Vec<U256>>,
) -> Result<Vec<U256>, WitnessCalculatorError> {
    let wasm_bytes = artifact_loader
        .load_wasm(circuit_name)
        .await
        .map_err(|e| WitnessCalculatorError::ArtifactLoaderError(Box::new(e)))?;

    info!("Loading WASM Module");
    let mut store = Store::default();
    let module = Module::new(&store, &wasm_bytes)?;
    let mut calculator = ark_circom::WitnessCalculator::from_module(&mut store, module)
        .map_err(|e| WitnessCalculatorError::CircomError(e.to_string()))?;

    // Convert inputs from U256 to BigInt
    let inputs: HashMap<String, Vec<BigInt>> = inputs
        .into_iter()
        .map(|(k, v)| (k, v.into_iter().map(BigInt::from).collect()))
        .collect();

    // Calculate witness
    info!("Calculating witness for circuit {}", circuit_name);
    let witness = calculator
        .calculate_witness(&mut store, inputs, true)
        .map_err(|e| WitnessCalculatorError::CircomError(e.to_string()))?;
    let witness: Vec<U256> = witness.into_iter().map(U256::from).collect();

    Ok(witness)
}

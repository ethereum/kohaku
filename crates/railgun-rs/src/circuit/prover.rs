use std::collections::HashMap;

use alloy::primitives::U256;

use crate::circuit::proof::Proof;

#[derive(Debug, thiserror::Error)]
#[error("Prover error: {0}")]
pub struct ProverError(#[source] Box<dyn std::error::Error + Send + Sync>);

impl ProverError {
    pub fn new(e: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self(Box::new(e))
    }
}

/// Prover trait for generating zk proofs.
#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait Prover: common::MaybeSend {
    async fn prove(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<Proof, ProverError>;

    #[tracing::instrument(name = "prove_transact", skip_all)]
    async fn prove_transact(
        &self,
        inputs: &crate::circuit::inputs::TransactCircuitInputs,
    ) -> Result<Proof, ProverError> {
        let nullifiers = inputs.nullifiers.len();
        let commitments = inputs.commitments_out.len();
        let circuit_name = format!("railgun/{:02}x{:02}", nullifiers, commitments);

        self.prove(&circuit_name, inputs.to_circuit_signals()).await
    }

    #[tracing::instrument(name = "prove_poi", skip_all)]
    async fn prove_poi(
        &self,
        inputs: &crate::circuit::inputs::PoiCircuitInputs,
    ) -> Result<Proof, ProverError> {
        let nullifiers = inputs.nullifiers.len();
        let commitments = inputs.commitments.len();
        let circuit_name = format!("railgun/poi/{:02}x{:02}", nullifiers, commitments);

        self.prove(&circuit_name, inputs.to_circuit_signals()).await
    }
}

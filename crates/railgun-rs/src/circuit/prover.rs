use std::collections::HashMap;

use alloy::primitives::U256;

use crate::circuit::proof::Proof;

/// Prover trait for generating zk proofs.
///
/// Returns a tuple of (proof, public_inputs).
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait Prover: common::MaybeSend {
    type Error: std::error::Error + Send + Sync + 'static;

    async fn prove(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<Proof, Self::Error>;

    #[tracing::instrument(name = "prove_transact", skip_all)]
    async fn prove_transact(
        &self,
        inputs: &crate::circuit::inputs::TransactCircuitInputs,
    ) -> Result<Proof, Self::Error> {
        let nullifiers = inputs.nullifiers.len();
        let commitments = inputs.commitments_out.len();
        let circuit_name = format!("railgun/{:02}x{:02}", nullifiers, commitments);

        self.prove(&circuit_name, inputs.to_circuit_signals()).await
    }

    #[tracing::instrument(name = "prove_poi", skip_all)]
    async fn prove_poi(
        &self,
        inputs: &crate::circuit::inputs::PoiCircuitInputs,
    ) -> Result<Proof, Self::Error> {
        let nullifiers = inputs.nullifiers.len();
        let commitments = inputs.commitments.len();
        let circuit_name = format!("railgun/poi/{:02}x{:02}", nullifiers, commitments);

        self.prove(&circuit_name, inputs.to_circuit_signals()).await
    }
}

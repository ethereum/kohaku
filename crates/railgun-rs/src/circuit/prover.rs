use prover::{Proof, Prover, ProverError};

#[tracing::instrument(name = "prove_transact", skip_all)]
pub async fn prove_transact(
    prover: &dyn Prover,
    inputs: &crate::circuit::inputs::TransactCircuitInputs,
) -> Result<Proof, ProverError> {
    let nullifiers = inputs.nullifiers.len();
    let commitments = inputs.commitments_out.len();
    let circuit_name = format!("railgun/{:02}x{:02}", nullifiers, commitments);

    Ok(prover.prove(&circuit_name, inputs.as_flat_map()).await?)
}

#[tracing::instrument(name = "prove_poi", skip_all)]
pub async fn prove_poi(
    prover: &dyn Prover,
    inputs: &crate::circuit::inputs::PoiCircuitInputs,
) -> Result<Proof, ProverError> {
    let nullifiers = inputs.nullifiers.len();
    let commitments = inputs.commitments.len();
    let circuit_name = format!("railgun/poi/{:02}x{:02}", nullifiers, commitments);

    Ok(prover.prove(&circuit_name, inputs.as_flat_map()).await?)
}

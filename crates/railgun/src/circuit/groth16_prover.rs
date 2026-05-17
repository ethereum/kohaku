use std::collections::HashMap;

use alloy::primitives::U256;
use ark_bn254::{Bn254, Fr};
use ark_circom::CircomReduction;
use ark_ff::BigInt;
use ark_groth16::{Groth16, prepare_verifying_key};
use ark_relations::gr1cs::SynthesisError;
use ark_std::rand::random;
use thiserror::Error;
use tracing::info;

use crate::circuit::{
    proof::Proof,
    remote_artifact_loader::{RemoteArtifactLoader, RemoteArtifactLoaderError},
    witness::{CalculateWitnessError, calculate_witness},
};

pub struct Groth16Prover {
    artifact_loader: RemoteArtifactLoader,
}

#[derive(Debug, Error)]
pub enum Groth16ProverError {
    #[error("Artifact loader error: {0}")]
    ArtifactLoaderError(#[from] RemoteArtifactLoaderError),
    #[error("Witness calculator error: {0}")]
    WitnessCalculatorError(#[from] CalculateWitnessError),
    #[error("Synthesis Error")]
    SynthesisError(#[from] SynthesisError),
    #[error("Proof verification failed")]
    InvalidProof,
}

impl Groth16Prover {
    pub fn new() -> Self {
        let artifact_loader = RemoteArtifactLoader::default();
        Groth16Prover { artifact_loader }
    }
}

impl Groth16Prover {
    #[tracing::instrument(name = "prove_transact", skip_all)]
    pub async fn prove_transact(
        &self,
        inputs: &crate::circuit::inputs::transact_inputs::TransactCircuitInputs,
    ) -> Result<Proof, Groth16ProverError> {
        let nullifiers = inputs.nullifiers.len();
        let commitments = inputs.commitments_out.len();
        let circuit_name = format!("railgun/{:02}x{:02}", nullifiers, commitments);

        self.prove(&circuit_name, inputs.to_circuit_signals()).await
    }

    #[tracing::instrument(name = "prove_poi", skip_all)]
    pub async fn prove_poi(
        &self,
        inputs: &crate::circuit::inputs::poi_inputs::PoiCircuitInputs,
    ) -> Result<Proof, Groth16ProverError> {
        let nullifiers = inputs.nullifiers.len();
        let commitments = inputs.commitments.len();
        let circuit_name = format!("railgun/poi/{:02}x{:02}", nullifiers, commitments);

        self.prove(&circuit_name, inputs.to_circuit_signals()).await
    }

    async fn prove(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<Proof, Groth16ProverError> {
        info!("Loading artifacts");
        let pk = self.artifact_loader.load_proving_key(circuit_name).await?;

        let matrices = self.artifact_loader.load_matrices(circuit_name).await?;

        info!("Calculating witness");
        let witnesses = calculate_witness(&self.artifact_loader, circuit_name, inputs).await?;
        let witnesses: Vec<Fr> = witnesses
            .iter()
            .map(|x| Fr::from(BigInt::from(*x)))
            .collect();

        let proof = Groth16::<Bn254, CircomReduction>::create_proof_with_reduction_and_matrices(
            &pk,
            random(),
            random(),
            &[matrices.a, matrices.b],
            matrices.num_instance_variables,
            matrices.num_constraints,
            &witnesses,
        )?;

        info!("Verifying proof");
        let public_inputs = &witnesses[1..matrices.num_instance_variables];
        let pvk = prepare_verifying_key(&pk.vk);
        let verified =
            Groth16::<Bn254, CircomReduction>::verify_proof(&pvk, &proof, &public_inputs)?;

        if !verified {
            return Err(Groth16ProverError::InvalidProof);
        }

        info!("Proof verified successfully");
        Ok(proof.into())
    }
}

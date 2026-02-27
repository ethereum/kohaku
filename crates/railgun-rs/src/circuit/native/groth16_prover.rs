use std::collections::HashMap;

use ark_bn254::{Bn254, Fr};
use ark_circom::CircomReduction;
use ark_ff::BigInt;
use ark_groth16::{Groth16, prepare_verifying_key};
use ark_std::rand::random;
use prover::{Prover, ProverError};
use ruint::aliases::U256;
use tracing::info;

use crate::circuit::{
    artifact_loader::ArtifactLoader,
    native::{WasmerWitnessCalculator, wasmer_witness_calculator},
};

pub struct Groth16Prover<A> {
    witness_calculator: WasmerWitnessCalculator<A>,
    artifact_loader: A,
}

impl<A: ArtifactLoader> Groth16Prover<A> {
    pub fn new(artifact_loader: A) -> Self {
        let witness_calculator =
            wasmer_witness_calculator::WasmerWitnessCalculator::new(artifact_loader.clone());
        Groth16Prover {
            witness_calculator,
            artifact_loader,
        }
    }
}

#[async_trait::async_trait]
impl<A: ArtifactLoader + Send + Sync + 'static> Prover for Groth16Prover<A> {
    async fn prove(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<(prover::Proof, Vec<U256>), ProverError> {
        info!("Loading artifacts");
        let pk = self
            .artifact_loader
            .load_proving_key(circuit_name)
            .await
            .map_err(ProverError::InvalidCircuit)?;

        let matrices = self
            .artifact_loader
            .load_matrices(circuit_name)
            .await
            .map_err(ProverError::InvalidCircuit)?;

        info!("Calculating witness");
        let witnesses = self
            .witness_calculator
            .calculate_witness(circuit_name, inputs)
            .await
            .map_err(ProverError::WitnessGeneration)?;
        let witnesses: Vec<Fr> = witnesses
            .iter()
            .map(|x| Fr::from(BigInt::from(*x)))
            .collect();

        info!("Creating proof");
        let proof = Groth16::<Bn254, CircomReduction>::create_proof_with_reduction_and_matrices(
            &pk,
            random(),
            random(),
            &matrices,
            matrices.num_instance_variables,
            matrices.num_constraints,
            &witnesses,
        )
        .map_err(|e| ProverError::Other(e.to_string()))?;

        info!("Verifying proof");
        let public_inputs = &witnesses[1..matrices.num_instance_variables];
        let pvk = prepare_verifying_key(&pk.vk);
        let verified =
            Groth16::<Bn254, CircomReduction>::verify_proof(&pvk, &proof, &public_inputs)
                .map_err(|e| ProverError::InvalidProof(e.to_string()))?;

        if !verified {
            return Err(ProverError::InvalidProof(
                "Proof verification failed".to_string(),
            ));
        }

        let public_inputs = public_inputs
            .iter()
            .map(|x| BigInt::from(*x).into())
            .collect();

        info!("Proof verified successfully");
        Ok((proof.into(), public_inputs))
    }
}

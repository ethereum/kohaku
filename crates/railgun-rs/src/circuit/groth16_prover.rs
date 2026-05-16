use std::{collections::HashMap, sync::Arc};

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
    artifact_loader::ArtifactLoader,
    proof::Proof,
    prover::{Prover, ProverError},
    witness_calculator::{WitnessCalculatorError, calculate_witness},
};

pub struct Groth16Prover {
    artifact_loader: Arc<dyn ArtifactLoader>,
}

#[derive(Debug, Error)]
pub enum Groth16ProverError {
    #[error("Artifact loader error: {0}")]
    ArtifactLoaderError(Box<dyn std::error::Error + Send + Sync + 'static>),
    #[error("Witness calculator error: {0}")]
    WitnessCalculatorError(#[from] WitnessCalculatorError),
    #[error("Synthesis Error")]
    SynthesisError(#[from] SynthesisError),
    #[error("Proof verification failed")]
    InvalidProof,
}

impl Groth16Prover {
    pub fn new(artifact_loader: Arc<dyn ArtifactLoader>) -> Self {
        Groth16Prover { artifact_loader }
    }
}

impl Groth16Prover {
    async fn prove(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<Proof, Groth16ProverError> {
        info!("Loading artifacts");
        let pk = self
            .artifact_loader
            .load_proving_key(circuit_name)
            .await
            .map_err(|e| Groth16ProverError::ArtifactLoaderError(Box::new(e)))?;

        let matrices = self
            .artifact_loader
            .load_matrices(circuit_name)
            .await
            .map_err(|e| Groth16ProverError::ArtifactLoaderError(Box::new(e)))?;

        info!("Calculating witness");
        let witnesses =
            calculate_witness(self.artifact_loader.as_ref(), circuit_name, inputs).await?;
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

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
impl Prover for Groth16Prover {
    async fn prove(
        &self,
        circuit_name: &str,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<Proof, ProverError> {
        self.prove(circuit_name, inputs)
            .await
            .map_err(ProverError::new)
    }
}

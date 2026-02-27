use std::collections::HashMap;

use ark_bn254::{Bn254, Fr};
use ark_circom::CircomReduction;
use ark_ff::BigInt;
use ark_groth16::{Groth16, prepare_verifying_key};
use ark_std::rand::random;
use ruint::aliases::U256;
use tracing::info;

#[cfg(feature = "poi")]
use crate::circuit::inputs::PoiCircuitInputs;
#[cfg(feature = "poi")]
use crate::circuit::prover::PoiProver;
use crate::circuit::{
    artifact_loader::ArtifactLoader,
    inputs::TransactCircuitInputs,
    native::{FsArtifactLoader, WasmerWitnessCalculator},
    prover::{PublicInputs, TransactProver},
    witness::{CircuitType, WitnessCalculator},
};

pub struct Groth16Prover<W, A> {
    witness_calculator: W,
    artifact_loader: A,
}

impl<W: WitnessCalculator, A: ArtifactLoader> Groth16Prover<W, A> {
    pub fn new(witness_calculator: W, artifact_loader: A) -> Self {
        Groth16Prover {
            witness_calculator,
            artifact_loader,
        }
    }
}

impl Groth16Prover<WasmerWitnessCalculator, FsArtifactLoader> {
    pub fn new_native(path: &str) -> Self {
        let witness_calculator = WasmerWitnessCalculator::new(path);
        let artifact_loader = FsArtifactLoader::new(path);
        Self::new(witness_calculator, artifact_loader)
    }
}

#[async_trait::async_trait]
impl<W: WitnessCalculator + Sync, A: ArtifactLoader + Sync> TransactProver for Groth16Prover<W, A> {
    #[tracing::instrument(skip_all)]
    async fn prove_transact(
        &self,
        inputs: &TransactCircuitInputs,
    ) -> Result<(prover::Proof, PublicInputs), Box<dyn std::error::Error>> {
        let circuit_type = CircuitType::Transact {
            nullifiers: inputs.nullifiers.len(),
            commitments: inputs.commitments_out.len(),
        };

        self.prove(circuit_type, inputs.as_flat_map()).await
    }
}

#[cfg(feature = "poi")]
#[async_trait::async_trait]
impl<W: WitnessCalculator + Sync, A: ArtifactLoader + Sync> PoiProver for Groth16Prover<W, A> {
    #[tracing::instrument(skip_all)]
    async fn prove_poi(
        &self,
        inputs: &PoiCircuitInputs,
    ) -> Result<(prover::Proof, PublicInputs), Box<dyn std::error::Error>> {
        let circuit_type = CircuitType::Poi {
            nullifiers: inputs.nullifiers.len(),
            commitments: inputs.commitments.len(),
        };

        self.prove(circuit_type, inputs.as_flat_map()).await
    }
}

impl<W: WitnessCalculator + Sync, A: ArtifactLoader + Sync> Groth16Prover<W, A> {
    pub async fn prove(
        &self,
        circuit_type: CircuitType,
        inputs: HashMap<String, Vec<U256>>,
    ) -> Result<(prover::Proof, PublicInputs), Box<dyn std::error::Error>> {
        info!("Loading artifacts");
        let pk = self.artifact_loader.load_proving_key(circuit_type).await?;
        let matrices = self.artifact_loader.load_matrices(circuit_type).await?;

        info!("Calculating witness");
        let witnesses = self
            .witness_calculator
            .calculate_witness(circuit_type, inputs)
            .await?;
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
        )?;

        info!("Verifying proof");
        let public_inputs = &witnesses[1..matrices.num_instance_variables];
        let pvk = prepare_verifying_key(&pk.vk);
        let verified =
            Groth16::<Bn254, CircomReduction>::verify_proof(&pvk, &proof, &public_inputs).unwrap();
        assert!(verified, "Proof verification failed");

        let public_inputs = public_inputs
            .iter()
            .map(|x| BigInt::from(*x).into())
            .collect();

        info!("Proof verified successfully");
        Ok((proof.into(), public_inputs))
    }
}

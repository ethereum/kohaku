use ark_bn254::{Bn254, Fr};
use ark_groth16::ProvingKey;
use ark_relations::r1cs::ConstraintMatrices;

#[async_trait::async_trait]
pub trait ArtifactLoader: Clone {
    async fn load_wasm(&self, circuit_name: &str) -> Result<Vec<u8>, String>;
    async fn load_proving_key(&self, circuit_name: &str) -> Result<ProvingKey<Bn254>, String>;
    async fn load_matrices(&self, circuit_name: &str) -> Result<ConstraintMatrices<Fr>, String>;
}

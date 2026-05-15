use ark_bn254::{Bn254, Fr};
use ark_circom::index::NPIndex;
use ark_groth16::ProvingKey;

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait ArtifactLoader: Clone {
    type Error: std::error::Error + Send + Sync + 'static;

    async fn load_wasm(&self, circuit_name: &str) -> Result<Vec<u8>, Self::Error>;
    async fn load_proving_key(&self, circuit_name: &str) -> Result<ProvingKey<Bn254>, Self::Error>;
    async fn load_matrices(&self, circuit_name: &str) -> Result<NPIndex<Fr>, Self::Error>;
}

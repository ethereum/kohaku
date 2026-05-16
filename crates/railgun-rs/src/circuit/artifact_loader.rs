use ark_bn254::{Bn254, Fr};
use ark_circom::index::NPIndex;
use ark_groth16::ProvingKey;

#[derive(Debug, thiserror::Error)]
#[error("Artifact loader error: {0}")]
pub struct ArtifactLoaderError(#[source] Box<dyn std::error::Error + Send + Sync + 'static>);

impl ArtifactLoaderError {
    pub fn new(e: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self(Box::new(e))
    }
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait ArtifactLoader: common::MaybeSend {
    async fn load_wasm(&self, circuit_name: &str) -> Result<Vec<u8>, ArtifactLoaderError>;
    async fn load_proving_key(
        &self,
        circuit_name: &str,
    ) -> Result<ProvingKey<Bn254>, ArtifactLoaderError>;
    async fn load_matrices(&self, circuit_name: &str) -> Result<NPIndex<Fr>, ArtifactLoaderError>;
}

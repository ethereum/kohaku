use std::io::Cursor;

use ark_bn254::{Bn254, Fr};
use ark_circom::index::NPIndex;
use ark_groth16::ProvingKey;
use ark_serialize::CanonicalDeserialize;
use tracing::info;

use crate::crypto::serializable_np_index::SerializableNpIndex;

#[derive(Clone)]
pub struct RemoteArtifactLoader {
    base_url: String,
    client: reqwest::Client,
}

#[derive(Debug, thiserror::Error)]
pub enum RemoteArtifactLoaderError {
    #[error("HTTP error: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("Deserialization error: {0}")]
    DeserializationError(#[from] ark_serialize::SerializationError),
}

impl Default for RemoteArtifactLoader {
    fn default() -> Self {
        Self::new(
            "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/",
        )
    }
}

impl RemoteArtifactLoader {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: reqwest::Client::new(),
        }
    }

    pub async fn load_wasm(
        &self,
        circuit_name: &str,
    ) -> Result<Vec<u8>, RemoteArtifactLoaderError> {
        info!("Downloading WASM: {}", circuit_name);
        let url = format!("{}/{}.wasm", self.base_url, circuit_name);
        let resp = self.client.get(&url).send().await?;
        let bytes = resp.bytes().await?;
        Ok(bytes.to_vec())
    }

    pub async fn load_proving_key(
        &self,
        circuit_name: &str,
    ) -> Result<ProvingKey<Bn254>, RemoteArtifactLoaderError> {
        info!("Downloading proving key: {}", circuit_name);
        let url = format!("{}/{}_proving_key.bin", self.base_url, circuit_name);
        let resp = self.client.get(&url).send().await?;
        let bytes = resp.bytes().await?;
        let pk = ProvingKey::<Bn254>::deserialize_uncompressed_unchecked(Cursor::new(bytes))?;

        Ok(pk)
    }

    pub async fn load_matrices(
        &self,
        circuit_name: &str,
    ) -> Result<NPIndex<Fr>, RemoteArtifactLoaderError> {
        info!("Downloading matrices: {}", circuit_name);
        let url = format!("{}/{}_matrices.bin", self.base_url, circuit_name);
        let resp = self.client.get(&url).send().await?;
        let bytes = resp.bytes().await?;

        let matrices =
            SerializableNpIndex::<Fr>::deserialize_uncompressed_unchecked(Cursor::new(bytes))?;

        Ok(matrices.into())
    }
}

use std::io::Cursor;

use ark_bn254::{Bn254, Fr};
use ark_circom::index::NPIndex;
use ark_groth16::ProvingKey;
use ark_serialize::CanonicalDeserialize;
use tracing::info;

use crate::{
    circuit::artifact_loader::ArtifactLoader, crypto::serializable_np_index::SerializableNpIndex,
};

#[derive(Clone)]
pub struct RemoteArtifactLoader {
    base_url: String,
    client: reqwest::Client,
}

impl RemoteArtifactLoader {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait::async_trait]
impl ArtifactLoader for RemoteArtifactLoader {
    async fn load_wasm(&self, circuit_name: &str) -> Result<Vec<u8>, String> {
        info!("Downloading WASM");
        let url = format!("{}/{}.wasm", self.base_url, circuit_name);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        Ok(bytes.to_vec())
    }

    async fn load_proving_key(&self, circuit_name: &str) -> Result<ProvingKey<Bn254>, String> {
        info!("Downloading proving key");
        let url = format!("{}/{}_proving_key.bin", self.base_url, circuit_name);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
        let pk = ProvingKey::<Bn254>::deserialize_uncompressed_unchecked(Cursor::new(bytes))
            .map_err(|e| e.to_string())?;

        Ok(pk)
    }

    async fn load_matrices(&self, circuit_name: &str) -> Result<NPIndex<Fr>, String> {
        info!("Downloading matrices");
        let url = format!("{}/{}_matrices.bin", self.base_url, circuit_name);
        let resp = self
            .client
            .get(&url)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let bytes = resp.bytes().await.map_err(|e| e.to_string())?;

        let matrices =
            SerializableNpIndex::<Fr>::deserialize_uncompressed_unchecked(Cursor::new(bytes))
                .map_err(|e| e.to_string())?;

        Ok(matrices.into())
    }
}

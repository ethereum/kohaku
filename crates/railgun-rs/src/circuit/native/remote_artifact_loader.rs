use std::io::Cursor;

use ark_bn254::{Bn254, Fr};
use ark_circom::read_zkey;
use ark_groth16::ProvingKey;
use ark_relations::r1cs::ConstraintMatrices;
use request::HttpClient;

use crate::circuit::artifact_loader::ArtifactLoader;

#[derive(Clone)]
pub struct RemoteArtifactLoader {
    base_url: String,
    client: HttpClient,
}

impl RemoteArtifactLoader {
    pub fn new(base_url: &str) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            client: HttpClient::new(None),
        }
    }

    async fn fetch_zkey(
        &self,
        circuit_name: &str,
    ) -> Result<(ProvingKey<Bn254>, ConstraintMatrices<Fr>), String> {
        let url = format!("{}/{}.zkey", self.base_url, circuit_name);
        let resp = self.client.get(&url).await.map_err(|e| e.to_string())?;
        let bytes = resp.into_body();
        let mut cursor = Cursor::new(bytes);
        let (pk, matrices) = read_zkey(&mut cursor).map_err(|e| e.to_string())?;
        Ok((pk, matrices))
    }
}

#[async_trait::async_trait]
impl ArtifactLoader for RemoteArtifactLoader {
    async fn load_wasm(&self, circuit_name: &str) -> Result<Vec<u8>, String> {
        let url = format!("{}/{}.wasm", self.base_url, circuit_name);
        let resp = self.client.get(&url).await.map_err(|e| e.to_string())?;
        Ok(resp.into_body())
    }

    async fn load_proving_key(&self, circuit_name: &str) -> Result<ProvingKey<Bn254>, String> {
        let (pk, _) = self.fetch_zkey(circuit_name).await?;
        Ok(pk)
    }

    async fn load_matrices(&self, circuit_name: &str) -> Result<ConstraintMatrices<Fr>, String> {
        let (_, matrices) = self.fetch_zkey(circuit_name).await?;
        Ok(matrices)
    }
}

use std::{
    collections::VecDeque,
    io::Cursor,
    sync::{Arc, Mutex},
};

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
    cache: Arc<Mutex<Cache>>,
}

struct Cache {
    entries: VecDeque<(String, Vec<u8>)>,
    total_bytes: usize,
    max_bytes: usize,
}

impl Cache {
    fn new(max_bytes: usize) -> Self {
        Self {
            entries: VecDeque::new(),
            total_bytes: 0,
            max_bytes,
        }
    }

    fn get(&self, url: &str) -> Option<Vec<u8>> {
        self.entries
            .iter()
            .find(|(k, _)| k == url)
            .map(|(_, v)| v.clone())
    }

    fn insert(&mut self, url: String, data: Vec<u8>) {
        let size = data.len();
        self.entries.push_back((url, data));
        self.total_bytes += size;
        while self.total_bytes > self.max_bytes {
            if let Some((_, evicted)) = self.entries.pop_front() {
                self.total_bytes -= evicted.len();
            } else {
                break;
            }
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum RemoteArtifactLoaderError {
    #[error("HTTP error: {0}")]
    HttpError(#[from] reqwest::Error),
    #[error("Deserialization error: {0}")]
    DeserializationError(#[from] ark_serialize::SerializationError),
    #[error("Decompression error: {0}")]
    DecompressionError(#[from] std::io::Error),
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
            cache: Arc::new(Mutex::new(Cache::new(64 * 1024 * 1024))),
        }
    }

    pub async fn load_wasm(
        &self,
        circuit_name: &str,
    ) -> Result<Vec<u8>, RemoteArtifactLoaderError> {
        info!("Downloading WASM: {}", circuit_name);
        let url = format!("{}/{}/wasm.br", self.base_url, circuit_name);
        let compressed = self.fetch(&url).await?;
        Ok(decompress(&compressed)?)
    }

    pub async fn load_proving_key(
        &self,
        circuit_name: &str,
    ) -> Result<ProvingKey<Bn254>, RemoteArtifactLoaderError> {
        info!("Downloading proving key: {}", circuit_name);
        let url = format!("{}/{}/proving_key.bin.br", self.base_url, circuit_name);
        let compressed = self.fetch(&url).await?;
        let bytes = decompress(&compressed)?;
        let pk = ProvingKey::<Bn254>::deserialize_uncompressed_unchecked(Cursor::new(bytes))?;
        Ok(pk)
    }

    pub async fn load_matrices(
        &self,
        circuit_name: &str,
    ) -> Result<NPIndex<Fr>, RemoteArtifactLoaderError> {
        info!("Downloading matrices: {}", circuit_name);
        let url = format!("{}/{}/matrices.bin.br", self.base_url, circuit_name);
        let compressed = self.fetch(&url).await?;
        let bytes = decompress(&compressed)?;
        let matrices =
            SerializableNpIndex::<Fr>::deserialize_uncompressed_unchecked(Cursor::new(bytes))?;
        Ok(matrices.into())
    }

    async fn fetch(&self, url: &str) -> Result<Vec<u8>, reqwest::Error> {
        if let Some(cached) = self.cache.lock().unwrap().get(url) {
            return Ok(cached);
        }
        let data = self.client.get(url).send().await?.bytes().await?.to_vec();
        self.cache
            .lock()
            .unwrap()
            .insert(url.to_string(), data.clone());
        Ok(data)
    }
}

fn decompress(data: &[u8]) -> Result<Vec<u8>, std::io::Error> {
    let mut out = Vec::new();
    brotli::BrotliDecompress(&mut &data[..], &mut out)?;
    Ok(out)
}

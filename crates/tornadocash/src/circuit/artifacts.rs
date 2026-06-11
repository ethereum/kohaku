use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use anyhow::Context;
use tracing::info;
use websnark_rs::{circuit::Circuit, proving_key::ProvingKey};

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
    #[error("Decompression error: {0}")]
    DecompressionError(#[from] std::io::Error),
    #[error(transparent)]
    Other(#[from] anyhow::Error),
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

    pub async fn load_circuit(&self) -> Result<Circuit, RemoteArtifactLoaderError> {
        info!("Downloading circuit");
        let url = format!("{}/tornadocash-classic/circuit.json.br", self.base_url);
        let compressed = self.fetch(&url).await?;
        let bytes = decompress(&compressed)?;
        let circuit =
            Circuit::from_json(&String::from_utf8(bytes).context("Invalid UTF-8 in circuit JSON")?)
                .context("Failed to parse circuit JSON")?;
        Ok(circuit)
    }

    pub async fn load_proving_key(&self) -> Result<ProvingKey, RemoteArtifactLoaderError> {
        info!("Downloading proving key");
        let url = format!("{}/tornadocash-classic/proving_key.bin.br", self.base_url);
        let compressed = self.fetch(&url).await?;
        let bytes = decompress(&compressed)?;
        let pk: ProvingKey =
            postcard::from_bytes(&bytes).context("Failed to deserialize proving key")?;
        Ok(pk)
    }

    async fn fetch(&self, url: &str) -> Result<Vec<u8>, reqwest::Error> {
        if let Some(cached) = self.cache.lock().unwrap().get(url) {
            info!("Cache hit for {}", url);
            return Ok(cached);
        }
        info!("Cache miss for {}, downloading...", url);
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

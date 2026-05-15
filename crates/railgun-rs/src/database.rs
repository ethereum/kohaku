use std::collections::HashMap;

use futures::lock::Mutex;
use serde::{Deserialize, Serialize};

use crate::railgun::{
    address::RailgunAddress,
    indexer::{
        indexed_account::IndexedAccountState, txid_indexer::TxidIndexerState,
        utxo_indexer::UtxoIndexerState,
    },
    merkle_tree::MerkleTreeState,
    poi::provider::PoiProviderState,
};

#[derive(Debug, thiserror::Error)]
pub enum DatabaseError {
    #[error("Serialization error: {0}")]
    SerializationError(#[from] serde_json::Error),
    #[error("Unsupported version: {0}")]
    UnsupportedVersion(u32),
    #[error("Storage error: {0}")]
    StorageError(String),
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(js, async_trait::async_trait(?Send))]
pub trait Database: common::MaybeSend {
    async fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>, DatabaseError>;
    async fn set(&self, key: &[u8], value: &[u8]) -> Result<(), DatabaseError>;
    async fn delete(&self, key: &[u8]) -> Result<(), DatabaseError>;
}

#[derive(Default)]
pub struct InMemoryDatabase {
    store: Mutex<HashMap<Vec<u8>, Vec<u8>>>,
}

impl InMemoryDatabase {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(js, async_trait::async_trait(?Send))]
impl Database for InMemoryDatabase {
    async fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>, DatabaseError> {
        let store = self.store.lock().await;
        Ok(store.get(key).cloned())
    }

    async fn set(&self, key: &[u8], value: &[u8]) -> Result<(), DatabaseError> {
        let mut store = self.store.lock().await;
        store.insert(key.to_vec(), value.to_vec());
        Ok(())
    }

    async fn delete(&self, key: &[u8]) -> Result<(), DatabaseError> {
        let mut store = self.store.lock().await;
        store.remove(key);
        Ok(())
    }
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(js, async_trait::async_trait(?Send))]
pub(crate) trait RailgunDB: Database + common::MaybeSend {
    async fn get_utxo_indexer(&self) -> Result<UtxoIndexerState, DatabaseError> {
        let key = utxo_indexer_key();
        let Some(bytes) = self.get(&key).await? else {
            return Ok(Default::default());
        };

        let envelope: Envelope = serde_json::from_slice(&bytes)?;
        match envelope.v {
            1 => Ok(serde_json::from_value(envelope.data)?),
            v => Err(DatabaseError::UnsupportedVersion(v)),
        }
    }

    async fn set_utxo_indexer(&self, state: &UtxoIndexerState) -> Result<(), DatabaseError> {
        self.write_envelope(&utxo_indexer_key(), 1, state).await
    }

    async fn get_account(
        &self,
        addr: &RailgunAddress,
    ) -> Result<IndexedAccountState, DatabaseError> {
        let key = account_key(addr);
        let Some(bytes) = self.get(&key).await? else {
            return Ok(Default::default());
        };

        let envelope: Envelope = serde_json::from_slice(&bytes)?;
        match envelope.v {
            1 => Ok(serde_json::from_value(envelope.data)?),
            v => Err(DatabaseError::UnsupportedVersion(v)),
        }
    }

    async fn set_account(
        &self,
        addr: &RailgunAddress,
        state: &IndexedAccountState,
    ) -> Result<(), DatabaseError> {
        self.write_envelope(&account_key(addr), 1, state).await
    }

    async fn get_utxo_tree(
        &self,
        tree_number: u32,
    ) -> Result<Option<MerkleTreeState>, DatabaseError> {
        let key = utxo_tree_key(tree_number);
        let Some(bytes) = self.get(&key).await? else {
            return Ok(None);
        };

        let envelope: Envelope = serde_json::from_slice(&bytes)?;
        match envelope.v {
            1 => Ok(Some(serde_json::from_value(envelope.data)?)),
            v => Err(DatabaseError::UnsupportedVersion(v)),
        }
    }

    async fn set_utxo_tree(
        &self,
        tree_number: u32,
        state: MerkleTreeState,
    ) -> Result<(), DatabaseError> {
        self.write_envelope(&utxo_tree_key(tree_number), 1, &state)
            .await
    }

    async fn get_txid_indexer(&self) -> Result<TxidIndexerState, DatabaseError> {
        let key = txid_indexer_key();
        let Some(bytes) = self.get(&key).await? else {
            return Ok(Default::default());
        };

        let envelope: Envelope = serde_json::from_slice(&bytes)?;
        match envelope.v {
            1 => Ok(serde_json::from_value(envelope.data)?),
            v => Err(DatabaseError::UnsupportedVersion(v)),
        }
    }

    async fn set_txid_indexer(&self, state: &TxidIndexerState) -> Result<(), DatabaseError> {
        self.write_envelope(&txid_indexer_key(), 1, state).await
    }

    async fn get_txid_tree(
        &self,
        tree_number: u32,
    ) -> Result<Option<MerkleTreeState>, DatabaseError> {
        let key = txid_tree_key(tree_number);
        let Some(bytes) = self.get(&key).await? else {
            return Ok(None);
        };

        let envelope: Envelope = serde_json::from_slice(&bytes)?;
        match envelope.v {
            1 => Ok(Some(serde_json::from_value(envelope.data)?)),
            v => Err(DatabaseError::UnsupportedVersion(v)),
        }
    }

    async fn set_txid_tree(
        &self,
        tree_number: u32,
        state: MerkleTreeState,
    ) -> Result<(), DatabaseError> {
        self.write_envelope(&txid_tree_key(tree_number), 1, &state)
            .await
    }

    async fn get_poi_provider(&self) -> Result<PoiProviderState, DatabaseError> {
        let key = poi_provider_key();
        let Some(bytes) = self.get(&key).await? else {
            return Ok(Default::default());
        };

        let envelope: Envelope = serde_json::from_slice(&bytes)?;
        match envelope.v {
            1 => Ok(serde_json::from_value(envelope.data)?),
            v => Err(DatabaseError::UnsupportedVersion(v)),
        }
    }

    async fn set_poi_provider(&self, state: &PoiProviderState) -> Result<(), DatabaseError> {
        self.write_envelope(&poi_provider_key(), 1, state).await
    }

    async fn write_envelope<S: Serialize + common::MaybeSend>(
        &self,
        key: &[u8],
        version: u32,
        data: &S,
    ) -> Result<(), DatabaseError> {
        let bytes = serialize_envelope(version, data)?;
        self.set(key, &bytes).await?;
        Ok(())
    }
}

impl<D: Database + ?Sized> RailgunDB for D {}

#[derive(Serialize, Deserialize)]
struct Envelope {
    pub v: u32,
    pub data: serde_json::Value,
}

fn serialize_envelope<T: Serialize>(version: u32, data: &T) -> Result<Vec<u8>, DatabaseError> {
    let envelope = Envelope {
        v: version,
        data: serde_json::to_value(data)?,
    };
    Ok(serde_json::to_vec(&envelope)?)
}

fn utxo_indexer_key() -> Vec<u8> {
    b"utxo_indexer".to_vec()
}

fn account_key(addr: &RailgunAddress) -> Vec<u8> {
    format!("account:{}", addr).into_bytes()
}

fn utxo_tree_key(tree_number: u32) -> Vec<u8> {
    format!("utxo_tree:{}", tree_number).into_bytes()
}

fn txid_indexer_key() -> Vec<u8> {
    b"txid_indexer".to_vec()
}

fn txid_tree_key(tree_number: u32) -> Vec<u8> {
    format!("txid_tree:{}", tree_number).into_bytes()
}

fn poi_provider_key() -> Vec<u8> {
    b"poi_provider".to_vec()
}

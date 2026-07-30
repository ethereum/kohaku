use alloy::primitives::B256;
use kohaku_db::{Database, DatabaseError};
use serde::{Deserialize, Serialize};

use crate::{merkle::TornadoMerkleTreeState, provider::pool::Pool};

/// Persisted indexer metadata for a single pool. The deposit merkle tree is stored separately.
#[derive(Serialize, Deserialize, Default)]
pub(crate) struct IndexerState {
    pub synced_block: u64,
    pub nullifiers: Vec<B256>,
}

/// Database trait extension with tornadocash-specific methods for storing and retrieving typed
/// per-pool indexer state.
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub(crate) trait TornadoDB: Database + common::MaybeSend {
    async fn get_indexer(&self, pool: &Pool) -> Result<IndexerState, DatabaseError> {
        let key = indexer_key(pool);
        let Some(bytes) = self.get(&key).await? else {
            return Ok(Default::default());
        };

        let envelope: Envelope = serde_json::from_slice(&bytes).map_err(DatabaseError::other)?;
        match envelope.v {
            1 => Ok(serde_json::from_value(envelope.data).map_err(DatabaseError::other)?),
            v => Err(DatabaseError::UnsupportedVersion(v)),
        }
    }

    async fn set_indexer(&self, pool: &Pool, state: &IndexerState) -> Result<(), DatabaseError> {
        self.write_envelope(&indexer_key(pool), 1, state).await
    }

    async fn get_tree(&self, pool: &Pool) -> Result<Option<TornadoMerkleTreeState>, DatabaseError> {
        let key = tree_key(pool);
        let Some(bytes) = self.get(&key).await? else {
            return Ok(None);
        };

        let envelope: Envelope = serde_json::from_slice(&bytes).map_err(DatabaseError::other)?;
        match envelope.v {
            1 => Ok(Some(
                serde_json::from_value(envelope.data).map_err(DatabaseError::other)?,
            )),
            v => Err(DatabaseError::UnsupportedVersion(v)),
        }
    }

    async fn set_tree(
        &self,
        pool: &Pool,
        state: TornadoMerkleTreeState,
    ) -> Result<(), DatabaseError> {
        self.write_envelope(&tree_key(pool), 1, &state).await
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

impl<D: Database + ?Sized> TornadoDB for D {}

#[derive(Serialize, Deserialize)]
struct Envelope {
    pub v: u32,
    pub data: serde_json::Value,
}

fn serialize_envelope<T: Serialize>(version: u32, data: &T) -> Result<Vec<u8>, DatabaseError> {
    let envelope = Envelope {
        v: version,
        data: serde_json::to_value(data).map_err(DatabaseError::other)?,
    };
    serde_json::to_vec(&envelope).map_err(DatabaseError::other)
}

fn indexer_key(pool: &Pool) -> Vec<u8> {
    format!("indexer:{pool}").into_bytes()
}

fn tree_key(pool: &Pool) -> Vec<u8> {
    format!("tree:{pool}").into_bytes()
}

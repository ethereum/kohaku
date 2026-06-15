use std::collections::HashMap;

use futures::lock::Mutex;

use crate::{Database, DatabaseError};

/// Basic in-memory KV database implementation.
#[derive(Default)]
pub struct MemoryDatabase {
    store: Mutex<HashMap<Vec<u8>, Vec<u8>>>,
}

impl MemoryDatabase {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(HashMap::new()),
        }
    }
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
impl Database for MemoryDatabase {
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

#[cfg(all(test, native))]
mod tests {
    use super::*;

    #[tokio::test]
    async fn round_trip() {
        let db = MemoryDatabase::new();
        assert_eq!(db.get(b"missing").await.unwrap(), None);

        db.set(b"key", b"value").await.unwrap();
        assert_eq!(db.get(b"key").await.unwrap(), Some(b"value".to_vec()));
    }

    #[tokio::test]
    async fn overwrite() {
        let db = MemoryDatabase::new();
        db.set(b"key", b"first").await.unwrap();
        db.set(b"key", b"second").await.unwrap();
        assert_eq!(db.get(b"key").await.unwrap(), Some(b"second".to_vec()));
    }

    #[tokio::test]
    async fn delete() {
        let db = MemoryDatabase::new();
        db.set(b"key", b"value").await.unwrap();
        db.delete(b"key").await.unwrap();
        assert_eq!(db.get(b"key").await.unwrap(), None);

        // Deleting a missing key is a no-op.
        db.delete(b"missing").await.unwrap();
    }
}

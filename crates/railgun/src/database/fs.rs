use std::{io, path::PathBuf};

use crate::database::{Database, DatabaseError};

/// Filesystem-backed KV database. Each key is stored as a hex-encoded file in `dir`.
pub struct FilesystemDatabase {
    dir: PathBuf,
}

impl FilesystemDatabase {
    pub fn new(dir: impl Into<PathBuf>) -> io::Result<Self> {
        let dir = dir.into();
        std::fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    fn key_path(&self, key: &[u8]) -> PathBuf {
        self.dir.join(hex::encode(key))
    }
}

#[async_trait::async_trait]
impl Database for FilesystemDatabase {
    async fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>, DatabaseError> {
        match tokio::fs::read(self.key_path(key)).await {
            Ok(data) => Ok(Some(data)),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(DatabaseError::StorageError(e.to_string())),
        }
    }

    async fn set(&self, key: &[u8], value: &[u8]) -> Result<(), DatabaseError> {
        tokio::fs::write(self.key_path(key), value)
            .await
            .map_err(|e| DatabaseError::StorageError(e.to_string()))
    }

    async fn delete(&self, key: &[u8]) -> Result<(), DatabaseError> {
        match tokio::fs::remove_file(self.key_path(key)).await {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(DatabaseError::StorageError(e.to_string())),
        }
    }
}

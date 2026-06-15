use std::{io, path::PathBuf};

use crate::{Database, DatabaseError};

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

#[cfg(test)]
mod tests {
    use super::*;

    /// Returns a unique, non-existent temp directory path for an isolated test.
    fn temp_dir() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("kohaku-db-test-{}-{}", std::process::id(), n))
    }

    #[tokio::test]
    async fn round_trip() {
        let dir = temp_dir();
        let db = FilesystemDatabase::new(&dir).unwrap();
        assert_eq!(db.get(b"missing").await.unwrap(), None);

        db.set(b"key", b"value").await.unwrap();
        assert_eq!(db.get(b"key").await.unwrap(), Some(b"value".to_vec()));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn overwrite() {
        let dir = temp_dir();
        let db = FilesystemDatabase::new(&dir).unwrap();
        db.set(b"key", b"first").await.unwrap();
        db.set(b"key", b"second").await.unwrap();
        assert_eq!(db.get(b"key").await.unwrap(), Some(b"second".to_vec()));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn delete() {
        let dir = temp_dir();
        let db = FilesystemDatabase::new(&dir).unwrap();
        db.set(b"key", b"value").await.unwrap();
        db.delete(b"key").await.unwrap();
        assert_eq!(db.get(b"key").await.unwrap(), None);

        // Deleting a missing key is a no-op.
        db.delete(b"missing").await.unwrap();

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn persists_across_instances() {
        let dir = temp_dir();

        let db = FilesystemDatabase::new(&dir).unwrap();
        db.set(b"key", b"value").await.unwrap();
        drop(db);

        let db = FilesystemDatabase::new(&dir).unwrap();
        assert_eq!(db.get(b"key").await.unwrap(), Some(b"value".to_vec()));

        std::fs::remove_dir_all(&dir).ok();
    }
}

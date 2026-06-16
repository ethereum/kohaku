//! Kohaku database module, providing a unified backend for various storage implementations.

#[cfg(native)]
pub mod fs;
#[cfg(wasm)]
pub mod js;
pub mod memory;

/// Key-value async database interface.
#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait Database: common::MaybeSend {
    async fn get(&self, key: &[u8]) -> Result<Option<Vec<u8>>, DatabaseError>;
    async fn set(&self, key: &[u8], value: &[u8]) -> Result<(), DatabaseError>;
    async fn delete(&self, key: &[u8]) -> Result<(), DatabaseError>;
}

#[derive(Debug, thiserror::Error)]
pub enum DatabaseError {
    #[error("Unsupported version: {0}")]
    UnsupportedVersion(u32),
    #[error("Storage error: {0}")]
    StorageError(String),
    #[error("Other error: {0}")]
    Other(#[source] Box<dyn std::error::Error + Send + Sync + 'static>),
}

impl DatabaseError {
    pub fn other(e: impl std::error::Error + Send + Sync + 'static) -> Self {
        DatabaseError::Other(Box::new(e))
    }
}

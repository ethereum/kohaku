use thiserror::Error;

use crate::railgun::merkle_tree::MerkleRoot;

/// Validates a Merkle root against an external authority (e.g. on-chain or a POI node).
#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
pub trait MerkleTreeVerifier: Send + Sync {
    async fn verify_root(
        &self,
        tree_number: u32,
        tree_index: u64,
        root: MerkleRoot,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>>;
}

/// Error returned when a Merkle tree fails remote verification.
#[derive(Debug, Error)]
pub enum VerificationError {
    #[error("Tree {tree_number} root {root} is not valid")]
    InvalidRoot { tree_number: u32, root: MerkleRoot },
    #[error("Verifier error: {0}")]
    VerifierError(Box<dyn std::error::Error + Send + Sync>),
}

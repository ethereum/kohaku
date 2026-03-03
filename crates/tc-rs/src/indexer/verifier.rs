use alloy_primitives::Address;
use crypto::merkle_tree::MerkleRoot;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum VerifierError {
    #[error("Invalid root: {root:?}")]
    InvalidRoot { root: MerkleRoot },
    #[error("Invalid contract {contract}: {reason}")]
    InvalidContract { contract: Address, reason: String },
    #[error("Other error: {0}")]
    Other(Box<dyn std::error::Error>),
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait Verifier: common::MaybeSend {
    async fn verify(&self, contract: Address, root: MerkleRoot) -> Result<(), VerifierError>;
}

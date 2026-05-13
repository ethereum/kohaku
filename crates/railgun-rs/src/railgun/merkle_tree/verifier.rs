use crate::railgun::merkle_tree::MerkleRoot;

/// Validates a Merkle root against an external authority (e.g. on-chain or a POI node).
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait MerkleTreeVerifier: common::MaybeSend {
    async fn verify_root(
        &self,
        tree_number: u32,
        tree_index: u64,
        root: MerkleRoot,
    ) -> Result<bool, Box<dyn std::error::Error>>;
}

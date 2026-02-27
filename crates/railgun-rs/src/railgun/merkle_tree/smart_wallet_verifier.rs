use alloy::{
    primitives::{Address, U256},
    providers::DynProvider,
};

use crate::{
    abis::railgun::RailgunSmartWallet,
    railgun::merkle_tree::{MerkleRoot, verifier::MerkleTreeVerifier},
};

/// Verifies UTXO Merkle roots against the deployed `RailgunSmartWallet` contract.
pub struct SmartWalletUtxoVerifier {
    address: Address,
    provider: DynProvider,
}

impl SmartWalletUtxoVerifier {
    pub fn new(address: Address, provider: DynProvider) -> Self {
        Self { address, provider }
    }
}

#[cfg_attr(not(feature = "wasm"), async_trait::async_trait)]
#[cfg_attr(feature = "wasm", async_trait::async_trait(?Send))]
impl MerkleTreeVerifier for SmartWalletUtxoVerifier {
    async fn verify_root(
        &self,
        tree_number: u32,
        _tree_index: u64,
        root: MerkleRoot,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
        let contract = RailgunSmartWallet::new(self.address, self.provider.clone());
        Ok(contract
            .rootHistory(U256::from(tree_number), root.into())
            .call()
            .await?)
    }
}

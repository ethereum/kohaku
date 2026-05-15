use std::sync::Arc;

use alloy::primitives::{Address, U256};
use eip_1193_provider::{Eip1193Provider, eth_call_sol};

use crate::{
    abis::railgun::RailgunSmartWallet,
    merkle_tree::{MerkleRoot, verifier::MerkleTreeVerifier},
};

/// Verifies UTXO Merkle roots against the deployed `RailgunSmartWallet` contract.
pub struct SmartWalletUtxoVerifier {
    address: Address,
    provider: Arc<dyn Eip1193Provider>,
}

impl SmartWalletUtxoVerifier {
    pub fn new(address: Address, provider: Arc<dyn Eip1193Provider>) -> Self {
        Self { address, provider }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl MerkleTreeVerifier for SmartWalletUtxoVerifier {
    async fn verify_root(
        &self,
        tree_number: u32,
        _tree_index: u32,
        root: MerkleRoot,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let root: U256 = root.into();
        Ok(eth_call_sol(
            self.provider.as_ref(),
            self.address,
            RailgunSmartWallet::rootHistoryCall {
                treeNumber: U256::from(tree_number),
                root: root.into(),
            },
        )
        .await?)
    }
}

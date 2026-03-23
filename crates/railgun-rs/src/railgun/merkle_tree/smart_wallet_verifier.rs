use std::sync::Arc;

use alloy_primitives::{Address, U256};
use eth_rpc::{EthRpcClient, eth_call_sol};

use crate::{
    abis::railgun::RailgunSmartWallet,
    railgun::merkle_tree::{MerkleRoot, verifier::MerkleTreeVerifier},
};

/// Verifies UTXO Merkle roots against the deployed `RailgunSmartWallet` contract.
pub struct SmartWalletUtxoVerifier {
    address: Address,
    provider: Arc<dyn EthRpcClient>,
}

impl SmartWalletUtxoVerifier {
    pub fn new(address: Address, provider: Arc<dyn EthRpcClient>) -> Self {
        Self { address, provider }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl MerkleTreeVerifier for SmartWalletUtxoVerifier {
    async fn verify_root(
        &self,
        tree_number: u32,
        _tree_index: u64,
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

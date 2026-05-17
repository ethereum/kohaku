use std::sync::Arc;

use alloy::primitives::{Address, U256};
use eip_1193_provider::provider::{Eip1193Caller, Eip1193Provider};

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

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
impl MerkleTreeVerifier for SmartWalletUtxoVerifier {
    async fn verify_root(
        &self,
        tree_number: u32,
        _tree_index: u32,
        root: MerkleRoot,
    ) -> Result<bool, Box<dyn std::error::Error>> {
        let root: U256 = root.into();
        Ok(self
            .provider
            .sol_call(
                self.address,
                RailgunSmartWallet::rootHistoryCall {
                    treeNumber: U256::from(tree_number),
                    root: root.into(),
                },
            )
            .await?)
    }
}

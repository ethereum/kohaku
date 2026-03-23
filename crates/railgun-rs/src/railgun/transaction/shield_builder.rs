use alloy_sol_types::SolCall;
use eth_rpc::TxData;
use rand::Rng;
use ruint::aliases::U256;
use thiserror::Error;

use crate::{
    abis::railgun::{RailgunSmartWallet, ShieldRequest},
    caip::AssetId,
    chain_config::ChainConfig,
    railgun::{
        address::RailgunAddress,
        note::encrypt::{EncryptError, encrypt_shield},
    },
};

/// Basic builder for constructing shield transactions.
pub struct ShieldBuilder {
    chain: ChainConfig,
    shields: Vec<(RailgunAddress, AssetId, u128)>,
}

#[derive(Debug, Error)]
pub enum ShieldError {
    #[error("Encryption error: {0}")]
    Encrypt(#[from] EncryptError),
}

impl ShieldBuilder {
    pub fn new(chain: ChainConfig) -> Self {
        Self {
            chain,
            shields: Vec::new(),
        }
    }

    /// Adds a shield operation to the transaction builder
    pub fn shield(mut self, recipient: RailgunAddress, asset: AssetId, value: u128) -> Self {
        self.shields.push((recipient, asset, value));
        self
    }

    /// Builds the shield transaction. Shield txns must be self-broadcast.
    pub fn build<R: Rng>(self, rng: &mut R) -> Result<TxData, ShieldError> {
        let shields = self
            .shields
            .into_iter()
            .map(|(r, a, v)| encrypt_shield(r, a, v, rng))
            .collect::<Result<Vec<ShieldRequest>, EncryptError>>()?;

        let call = RailgunSmartWallet::shieldCall {
            _shieldRequests: shields,
        };
        let calldata = call.abi_encode();

        Ok(TxData {
            to: self.chain.railgun_smart_wallet,
            data: calldata.into(),
            value: U256::ZERO,
        })
    }
}

#[cfg(test)]
mod tests {
    use alloy_primitives::Address;
    use rand::SeedableRng;
    use rand_chacha::ChaChaRng;

    use super::*;
    use crate::{
        chain_config::MAINNET_CONFIG,
        crypto::keys::{SpendingKey, ViewingKey},
        railgun::{PrivateKeySigner, Signer},
    };

    #[test]
    fn test_shield_builder() {
        let mut rng = ChaChaRng::seed_from_u64(0);
        let spending_key: SpendingKey = rng.random();
        let viewing_key: ViewingKey = rng.random();
        let signer = PrivateKeySigner::new_evm(spending_key, viewing_key, 1);
        let recipient = signer.address();

        let asset: AssetId = AssetId::Erc20(Address::from([0u8; 20]));
        let value: u128 = 1_000_000;

        let shield_request = ShieldBuilder::new(MAINNET_CONFIG)
            .shield(recipient, asset, value)
            .build(&mut rng)
            .unwrap();

        insta::assert_debug_snapshot!(shield_request);
    }
}

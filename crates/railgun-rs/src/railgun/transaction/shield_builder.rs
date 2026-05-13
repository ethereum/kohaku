use alloy::{primitives::U256, sol_types::SolCall};
use eip_1193_provider::TxData;
use rand::Rng;
use thiserror::Error;

use crate::{
    abis::railgun::{RailgunSmartWallet, RelayAdapt, ShieldRequest},
    caip::AssetId,
    chain_config::ChainConfig,
    railgun::{
        address::RailgunAddress,
        note::encrypt::{EncryptError, encrypt_shield},
    },
};

/// Basic builder for constructing shield transactions. Shield transactions
/// are used to move assets from an external address into the RAILGUN protocol.
/// They consume assets from a single EOA, shielding them into a number of
/// RAILGUN accounts in a single transaction.
///
/// Shield transactions must be self-broadcast.
pub struct ShieldBuilder {
    chain: ChainConfig,
    shields: Vec<(RailgunAddress, AssetId, u128)>,
    native_shields: Vec<(RailgunAddress, u128)>,
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
            native_shields: Vec::new(),
        }
    }

    /// Adds a shield operation to the transaction builder
    pub fn shield(mut self, recipient: RailgunAddress, asset: AssetId, value: u128) -> Self {
        self.shields.push((recipient, asset, value));
        self
    }

    /// Adds a shield operation for a native asset to the transaction builder
    pub fn shield_native(mut self, recipient: RailgunAddress, value: u128) -> Self {
        self.native_shields.push((recipient, value));
        self
    }

    /// Builds the shield transaction. Shield txns must be self-broadcast
    pub fn build<R: Rng>(self, rng: &mut R) -> Result<Vec<TxData>, ShieldError> {
        // We return multiple txns here rather than using the RelayAdapt multicall for
        // all shields. This is because when calling the RailgunSmartWallet to shield,
        // it assumes that the caller (msg.sender) holds the assets & has approved
        // the RailgunSmartWallet to spend them. In theory we could approve the RelayAdapt
        // to spend, then transferFrom & approve in the multicall. But this is more complex
        // and means we need to know the msg.sender address beforehand, which adds a
        // public API requirement. Just having two txns is simpler and more gas efficient,
        // just slightly less elegant.

        let mut txns = Vec::new();

        if !self.shields.is_empty() {
            let shields = self
                .shields
                .into_iter()
                .map(|(r, a, v)| encrypt_shield(r, a, v, rng))
                .collect::<Result<Vec<ShieldRequest>, EncryptError>>()?;

            let call = RailgunSmartWallet::shieldCall {
                _shieldRequests: shields,
            };

            txns.push(TxData {
                to: self.chain.railgun_smart_wallet,
                data: call.abi_encode().into(),
                value: U256::ZERO,
            });
        }

        if !self.native_shields.is_empty() {
            let native_total: u128 = self.native_shields.iter().map(|(_, v)| v).sum();
            let native_shields = self
                .native_shields
                .into_iter()
                .map(|(r, v)| {
                    encrypt_shield(r, AssetId::Erc20(self.chain.wrapped_base_token), v, rng)
                })
                .collect::<Result<Vec<ShieldRequest>, EncryptError>>()?;

            let wrap_calldata = RelayAdapt::wrapBaseCall {
                _amount: U256::from(native_total),
            };
            let shield_calldata = RelayAdapt::shieldCall {
                _shieldRequests: native_shields,
            };

            let relay = self.chain.relay_adapt_contract;
            let calls = vec![
                RelayAdapt::Call {
                    to: relay,
                    data: wrap_calldata.abi_encode().into(),
                    value: U256::ZERO,
                },
                RelayAdapt::Call {
                    to: relay,
                    data: shield_calldata.abi_encode().into(),
                    value: U256::ZERO,
                },
            ];
            let multicall = RelayAdapt::multicallCall {
                _requireSuccess: true,
                _calls: calls,
            };

            txns.push(TxData {
                to: relay,
                data: multicall.abi_encode().into(),
                value: U256::from(native_total),
            });
        }

        Ok(txns)
    }
}

#[cfg(all(test, native))]
mod tests {
    use alloy::primitives::Address;
    use rand::SeedableRng;
    use rand_chacha::ChaChaRng;

    use super::*;
    use crate::{
        crypto::keys::{SpendingKey, ViewingKey},
        railgun::{PrivateKeySigner, RailgunSigner},
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

        let shield_request = ShieldBuilder::new(ChainConfig::mainnet())
            .shield(recipient, asset, value)
            .build(&mut rng)
            .unwrap();

        insta::assert_debug_snapshot!(shield_request);
    }

    #[test]
    fn test_shield_builder_native_eth_uses_relay_adapt() {
        let mut rng = ChaChaRng::seed_from_u64(0);
        let spending_key: SpendingKey = rng.random();
        let viewing_key: ViewingKey = rng.random();
        let signer = PrivateKeySigner::new_evm(spending_key, viewing_key, 1);
        let recipient = signer.address();

        let tx = ShieldBuilder::new(ChainConfig::mainnet())
            .shield_native(recipient, 1_000_000)
            .build(&mut rng)
            .unwrap();

        insta::assert_debug_snapshot!(tx);
    }
}

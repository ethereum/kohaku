use alloy_sol_types::SolCall;
use eth_rpc::TxData;
use rand::Rng;
use ruint::aliases::U256;
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
}

#[derive(Debug, Error)]
pub enum ShieldError {
    #[error("Encryption error: {0}")]
    Encrypt(#[from] EncryptError),
    #[error("Sum of native shield amounts overflowed u128")]
    NativeAmountOverflow,
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
        let mut native_total: u128 = 0;
        for (_, asset, value) in &self.shields {
            if asset.is_native_base_token() {
                native_total = native_total
                    .checked_add(*value)
                    .ok_or(ShieldError::NativeAmountOverflow)?;
            }
        }

        let weth = self.chain.wrapped_base_token;
        let shields = self
            .shields
            .into_iter()
            .map(|(r, a, v)| {
                let enc_asset = if a.is_native_base_token() {
                    AssetId::Erc20(weth)
                } else {
                    a
                };
                encrypt_shield(r, enc_asset, v, rng)
            })
            .collect::<Result<Vec<ShieldRequest>, EncryptError>>()?;

        if native_total == 0 {
            let call = RailgunSmartWallet::shieldCall {
                _shieldRequests: shields,
            };
            return Ok(TxData {
                to: self.chain.railgun_smart_wallet,
                data: call.abi_encode().into(),
                value: U256::ZERO,
            });
        }

        let relay = self.chain.relay_adapt_contract;
        let wrap_calldata = RelayAdapt::wrapBaseCall {
            _amount: U256::from(native_total),
        }
        .abi_encode();
        let shield_calldata = RelayAdapt::shieldCall {
            _shieldRequests: shields,
        }
        .abi_encode();

        let calls = vec![
            RelayAdapt::Call {
                to: relay,
                data: wrap_calldata.into(),
                value: U256::ZERO,
            },
            RelayAdapt::Call {
                to: relay,
                data: shield_calldata.into(),
                value: U256::ZERO,
            },
        ];

        let multicall = RelayAdapt::multicallCall {
            _requireSuccess: true,
            _calls: calls,
        };

        Ok(TxData {
            to: relay,
            data: multicall.abi_encode().into(),
            value: U256::from(native_total),
        })
    }
}

#[cfg(test)]
mod tests {
    use alloy_primitives::{Address, address};
    use rand::SeedableRng;
    use rand_chacha::ChaChaRng;
    use ruint::aliases::U256;

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

        // Non-zero ERC-20: must target RailgunSmartWallet.shield directly (not RelayAdapt).
        let asset: AssetId = AssetId::Erc20(address!("0x0000000000000000000000000000000000000001"));
        let value: u128 = 1_000_000;

        let shield_request = ShieldBuilder::new(MAINNET_CONFIG)
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

        let native: AssetId = AssetId::Erc20(Address::ZERO);
        let tx = ShieldBuilder::new(MAINNET_CONFIG)
            .shield(recipient, native, 1_000_000)
            .build(&mut rng)
            .unwrap();

        assert_eq!(tx.to, MAINNET_CONFIG.relay_adapt_contract);
        assert_eq!(tx.value, U256::from(1_000_000u128));
        assert!(!tx.data.is_empty());
    }
}

use alloy::primitives::U256;
use alloy_sol_types::SolCall;
use crypto::poseidon_hash;
use rand::Rng;
use ruint::Uint;
use thiserror::Error;

use crate::{
    abis::railgun::{CommitmentPreimage, RailgunSmartWallet, ShieldCiphertext, ShieldRequest},
    caip::AssetId,
    chain_config::ChainConfig,
    crypto::{
        concat_arrays,
        keys::{ByteKey, U256Key, ViewingKey},
    },
    railgun::{address::RailgunAddress, transaction::tx_data::TxData},
};

/// Basic builder for constructing shield transactions.
pub struct ShieldBuilder {
    chain: ChainConfig,
    shields: Vec<(RailgunAddress, AssetId, u128)>,
}

#[derive(Debug, Error)]
pub enum ShieldError {}

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
            .map(|(r, a, v)| create_shield_request(r, a, v, rng))
            .collect::<Result<Vec<ShieldRequest>, ShieldError>>()?;

        let call = RailgunSmartWallet::shieldCall {
            _shieldRequests: shields,
        };
        let calldata = call.abi_encode();

        Ok(TxData {
            to: self.chain.railgun_smart_wallet,
            data: calldata,
            value: U256::ZERO,
        })
    }
}

fn create_shield_request<R: Rng>(
    recipient: RailgunAddress,
    asset: AssetId,
    value: u128,
    rng: &mut R,
) -> Result<ShieldRequest, ShieldError> {
    let shield_private_key: ViewingKey = rng.random();
    let shared_key = shield_private_key
        .derive_shared_key(recipient.viewing_pubkey())
        .unwrap();

    let random_seed: [u8; 16] = rng.random();
    let mut npk: [u8; 32] = poseidon_hash(&[
        recipient.master_key().to_u256(),
        U256::from_be_slice(&random_seed),
    ])
    .unwrap()
    .to_le_bytes();
    npk.reverse();

    let gcm = shared_key.encrypt_gcm(&[&random_seed], rng).unwrap();
    let ctr = shield_private_key.encrypt_ctr(&[recipient.viewing_pubkey().as_bytes()], rng);

    let gcm_random: [u8; 16] = gcm.data[0].clone().try_into().unwrap();
    let ctr_key: [u8; 32] = ctr.data[0].clone().try_into().unwrap();

    Ok(ShieldRequest {
        preimage: CommitmentPreimage {
            npk: npk.into(),
            token: asset.into(),
            value: Uint::from(value),
        },
        ciphertext: ShieldCiphertext {
            // iv (16) | tag (16)
            // random (16) | ctr iv (16)
            // receiver_viewing_key (32)
            encryptedBundle: [
                concat_arrays(&gcm.iv, &gcm.tag).into(),
                concat_arrays(&gcm_random, &ctr.iv).into(),
                ctr_key.into(),
            ],
            shieldKey: shield_private_key.public_key().to_u256().into(),
        },
    })
}

#[cfg(test)]
mod tests {
    use alloy::primitives::Address;
    use rand::SeedableRng;
    use rand_chacha::ChaChaRng;
    use tracing_test::traced_test;

    use super::*;
    use crate::{
        crypto::keys::SpendingKey,
        railgun::{
            PrivateKeySigner, Signer,
            address::ChainId,
            note::{Note, utxo::UtxoNote},
        },
    };

    #[test]
    #[traced_test]
    fn test_shield_snap() {
        let mut rng = ChaChaRng::seed_from_u64(0);

        let spending_key: SpendingKey = rng.random();
        let viewing_key: ViewingKey = rng.random();

        let recipient =
            RailgunAddress::from_private_keys(spending_key, viewing_key, ChainId::EVM(1));
        let asset: AssetId = AssetId::Erc20(Address::from([0u8; 20]));
        let value: u128 = 1_000_000;

        let shield_request = create_shield_request(recipient, asset, value, &mut rng).unwrap();
        insta::assert_debug_snapshot!(shield_request);
    }

    #[test]
    #[traced_test]
    fn test_shield_encrypt_decrypt() {
        let mut rng = ChaChaRng::seed_from_u64(0);

        let spending_key: SpendingKey = rng.random();
        let viewing_key: ViewingKey = rng.random();
        let signer = PrivateKeySigner::new_evm(spending_key, viewing_key, 1);
        let recipient = signer.address();

        let asset: AssetId = AssetId::Erc20(Address::from([0u8; 20]));
        let value: u128 = 1_000_000;

        let shield_request = create_shield_request(recipient, asset, value, &mut rng).unwrap();

        // Decrypt the note
        let decrypted = UtxoNote::decrypt_shield_request(signer, 1, 0, shield_request)
            .expect("Failed to decrypt shield note");

        assert_eq!(decrypted.value(), value);
        assert_eq!(decrypted.asset(), asset);
        assert_eq!(decrypted.memo(), "");
    }
}

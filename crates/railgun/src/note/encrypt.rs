use crypto::poseidon_hash;
use curve25519_dalek::{Scalar, edwards::CompressedEdwardsY};
use rand::{Rng, RngCore};
use ruint::{Uint, aliases::U256};
use sha2::{Digest, Sha512};
use thiserror::Error;

use crate::{
    abis::railgun::{CommitmentCiphertext, CommitmentPreimage, ShieldCiphertext, ShieldRequest},
    account::address::RailgunAddress,
    caip::AssetId,
    crypto::{
        aes::AesError,
        keys::{BlindedKey, ByteKey, KeyError, U256Key, ViewingKey, ViewingPublicKey},
        railgun_base_37,
    },
};

#[derive(Debug, Error)]
pub enum EncryptError {
    #[error("Railgun base37 encoding error: {0}")]
    RailgunBase37(#[from] railgun_base_37::EncodingError),
    #[error("AES encryption error: {0}")]
    Aes(#[from] AesError),
    #[error("Key error: {0}")]
    Key(#[from] KeyError),
}

/// Encrypts a note into a CommitmentCiphertext
///
/// TODO: Add details on blind
pub fn encrypt_note<R: RngCore + ?Sized>(
    receiver: &RailgunAddress,
    shared_random: &[u8; 16],
    value: u128,
    asset: &AssetId,
    memo: &str,
    viewing_key: ViewingKey,
    blind: bool,
    rng: &mut R,
) -> Result<CommitmentCiphertext, EncryptError> {
    let output_type = 0;
    let application_identifier = railgun_base_37::encode("railgun rs")?;
    let sender_random: [u8; 15] = if blind { rng.random() } else { [0u8; 15] };

    let (blinded_sender, blinded_receiver) = blind_viewing_keys(
        viewing_key.public_key(),
        receiver.viewing_pubkey(),
        &concat_arrays(shared_random, &[0u8; 16]),
        &concat_arrays(&sender_random, &[0u8; 17]),
    )?;

    let shared_key = viewing_key.derive_shared_key_blinded(blinded_receiver)?;
    let gcm = shared_key.encrypt_gcm(
        &[
            receiver.master_key().as_bytes(),
            &asset.hash().to_be_bytes_vec(),
            &concat_arrays::<16, 16, 32>(shared_random, &value.to_be_bytes()),
            memo.as_bytes(),
        ],
        &rng.random(),
    )?;

    let ctr0: [u8; 16] = concat_arrays(&[output_type], &sender_random);
    let ctr1 = [0u8; 16];
    let ctr2 = application_identifier;
    let ctr = viewing_key.encrypt_ctr(&[&ctr0, &ctr1, &ctr2], &rng.random());

    let bundle_1: [u8; 32] = gcm.data[0].clone().try_into().unwrap();
    let bundle_2: [u8; 32] = gcm.data[1].clone().try_into().unwrap();
    let bundle_3: [u8; 32] = gcm.data[2].clone().try_into().unwrap();

    Ok(CommitmentCiphertext {
        // iv (16) | tag (16)
        // master_public_key (32)
        // token_hash (32)
        // random (16) | value (16)
        ciphertext: [
            concat_arrays(&gcm.iv, &gcm.tag).into(),
            bundle_1.into(),
            bundle_2.into(),
            bundle_3.into(),
        ],
        blindedSenderViewingKey: blinded_sender.to_u256().into(),
        blindedReceiverViewingKey: blinded_receiver.to_u256().into(),
        // ctr_iv (16) | outputType (1) | senderRandom (15) | padding (16) | applicationIdentifier
        // (16)
        annotationData: [ctr.iv.as_slice(), &ctr.data[0], &ctr.data[1], &ctr.data[2]]
            .concat()
            .into(),
        memo: gcm.data[3].clone().into(),
    })
}

pub fn encrypt_shield<R: Rng>(
    recipient: RailgunAddress,
    asset: AssetId,
    value: u128,
    rng: &mut R,
) -> Result<ShieldRequest, EncryptError> {
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

    let gcm = shared_key
        .encrypt_gcm(&[&random_seed], &rng.random())
        .unwrap();
    let ctr =
        shield_private_key.encrypt_ctr(&[recipient.viewing_pubkey().as_bytes()], &rng.random());

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

pub fn blind_viewing_keys(
    sender: ViewingPublicKey,
    receiver: ViewingPublicKey,
    shared_random: &[u8; 32],
    sender_random: &[u8; 32],
) -> Result<(BlindedKey, BlindedKey), KeyError> {
    let sender_point = CompressedEdwardsY(*sender.as_bytes())
        .decompress()
        .ok_or(KeyError::DecompressionFailed)?;
    let receiver_point = CompressedEdwardsY(*receiver.as_bytes())
        .decompress()
        .ok_or(KeyError::DecompressionFailed)?;

    let mut final_random = [0u8; 32];
    for i in 0..32 {
        final_random[i] = shared_random[i] ^ sender_random[i];
    }

    let hash = Sha512::digest(final_random);
    let mut hash_bytes: [u8; 64] = hash.into();
    hash_bytes.reverse();
    let scalar = Scalar::from_bytes_mod_order_wide(&hash_bytes);

    Ok((
        BlindedKey::from_bytes((sender_point * scalar).compress().to_bytes()),
        BlindedKey::from_bytes((receiver_point * scalar).compress().to_bytes()),
    ))
}

/// Concatenates two sized arrays into a new sized array. The output size must be the sum of the
/// input sizes.
fn concat_arrays<const A: usize, const B: usize, const C: usize>(
    a: &[u8; A],
    b: &[u8; B],
) -> [u8; C] {
    assert_eq!(A + B, C);
    let mut out = [0u8; C];
    out[..A].copy_from_slice(a);
    out[A..].copy_from_slice(b);
    out
}

#[cfg(all(test, native))]
mod tests {
    use alloy::primitives::{Address, address};
    use rand_chacha::{ChaChaRng, rand_core::SeedableRng};
    use tracing_test::traced_test;

    use super::*;
    use crate::{
        account::{
            chain::ChainId,
            signer::{PrivateKeySigner, RailgunSigner},
        },
        crypto::keys::{HexKey, SpendingKey},
    };

    #[test]
    fn test_encrypt_snap() {
        let mut rand = ChaChaRng::seed_from_u64(0);
        let chain_id = 1;

        // Sender keys
        let sender_viewing_key = ViewingKey::from_bytes([2u8; 32]);

        // Receiver keys
        let receiver_spending_key = SpendingKey::from_bytes([3u8; 32]);
        let receiver_viewing_key = ViewingKey::from_bytes([4u8; 32]);
        let receiver =
            PrivateKeySigner::new_evm(receiver_spending_key, receiver_viewing_key, chain_id)
                .address();

        let shared_random = [5u8; 16];
        let value = 1000u128;
        let asset = AssetId::Erc20(address!("0x1234567890123456789012345678901234567890"));
        let memo = "test memo";

        let encrypted = encrypt_note(
            &receiver,
            &shared_random,
            value,
            &asset,
            memo,
            sender_viewing_key,
            false,
            &mut rand,
        )
        .unwrap();

        insta::assert_debug_snapshot!(encrypted);
    }

    #[test]
    #[traced_test]
    fn test_encrypt_shield_snap() {
        let mut rng = ChaChaRng::seed_from_u64(0);

        let spending_key: SpendingKey = rng.random();
        let viewing_key: ViewingKey = rng.random();

        let recipient =
            RailgunAddress::from_private_keys(spending_key, viewing_key, ChainId::evm(1));
        let asset: AssetId = AssetId::Erc20(Address::from([0u8; 20]));
        let value: u128 = 1_000_000;

        let shield_request = encrypt_shield(recipient, asset, value, &mut rng).unwrap();
        insta::assert_debug_snapshot!(shield_request);
    }

    #[test]
    #[traced_test]
    fn test_blinded_key() {
        let viewing_key = ViewingKey::from_bytes([2u8; 32]);
        let their_viewing = ViewingKey::from_bytes([3u8; 32]);
        let shared_random = [4u8; 32];
        let sender_random = [5u8; 32];

        let (blinded, their_blinded) = blind_viewing_keys(
            viewing_key.public_key(),
            their_viewing.public_key(),
            &shared_random,
            &sender_random,
        )
        .unwrap();

        let expected_blinded = "2ed993356db2b8b5e573da394c2317942c9a1a72eb9a8dfd02705cc56cb1423b";
        let expected_their_blinded =
            "90878634485e306dc7f31840362fc43532313cea73c9006a19b0718e298ffcce";

        assert_eq!(expected_blinded, blinded.to_hex());
        assert_eq!(expected_their_blinded, their_blinded.to_hex());
    }

    #[test]
    #[traced_test]
    fn test_shared_blinded_key() {
        let viewing_key = ViewingKey::from_bytes([2u8; 32]);
        let their_viewing = ViewingKey::from_bytes([3u8; 32]);
        let shared_random = [4u8; 32];
        let sender_random = [5u8; 32];

        let (blinded, their_blinded) = blind_viewing_keys(
            viewing_key.public_key(),
            their_viewing.public_key(),
            &shared_random,
            &sender_random,
        )
        .unwrap();

        let shared_key_ab = viewing_key
            .derive_shared_key_blinded(their_blinded)
            .unwrap();
        let shared_key_ba = their_viewing.derive_shared_key_blinded(blinded).unwrap();

        let expected_shared_key =
            "2d33b7ea38413dfd631149f00dd0745f06dc06cd8112a6a174c73fa97af8d5a0";

        assert_eq!(shared_key_ab.to_hex(), shared_key_ba.to_hex());
        assert_eq!(expected_shared_key, shared_key_ab.to_hex());
    }
}

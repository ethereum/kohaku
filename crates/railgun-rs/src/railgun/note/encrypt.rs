use rand::Rng;
use thiserror::Error;

use crate::{
    abis::railgun::CommitmentCiphertext,
    caip::AssetId,
    crypto::{
        aes::{AesError, encrypt_ctr},
        concat_arrays,
        keys::{ByteKey, KeyError, U256Key, ViewingKey, blind_viewing_keys},
        railgun_base_37,
    },
    railgun::address::RailgunAddress,
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
pub fn encrypt_note<R: Rng + ?Sized>(
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
        rng,
    )?;

    let ctr0: [u8; 16] = concat_arrays(&[output_type], &sender_random);
    let ctr1 = [0u8; 16];
    let ctr2 = application_identifier;
    let ctr = encrypt_ctr(
        &[&ctr0, &ctr1, &ctr2],
        viewing_key.public_key().as_bytes(),
        rng,
    );

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
        // ctr_iv (16) | outputType (1) | senderRandom (15) | padding (16) | applicationIdentifier (16)
        annotationData: [ctr.iv.as_slice(), &ctr.data[0], &ctr.data[1], &ctr.data[2]]
            .concat()
            .into(),
        memo: gcm.data[3].clone().into(),
    })
}

#[cfg(test)]
mod tests {
    use alloy::primitives::address;
    use rand_chacha::{ChaChaRng, rand_core::SeedableRng};
    use tracing_test::traced_test;

    use super::*;
    use crate::{
        crypto::keys::SpendingKey,
        railgun::{
            note::utxo::{UtxoNote, UtxoType},
            signer::{PrivateKeySigner, Signer},
        },
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
    fn test_encrypt_decrypt_note() {
        let mut rand = ChaChaRng::seed_from_u64(0);
        let chain_id = 1;

        // Sender keys
        let sender_viewing_key = ViewingKey::from_bytes([2u8; 32]);

        // Receiver keys
        let receiver_spending_key = SpendingKey::from_bytes([3u8; 32]);
        let receiver_viewing_key = ViewingKey::from_bytes([4u8; 32]);
        let signer =
            PrivateKeySigner::new_evm(receiver_spending_key, receiver_viewing_key, chain_id);
        let receiver = signer.address();

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

        // Receiver decrypts with their own keys
        let decrypted = UtxoNote::decrypt(signer.clone(), 1, 0, &encrypted).unwrap();
        let expected = UtxoNote::new(
            1,
            0,
            signer,
            asset,
            value,
            shared_random,
            memo,
            UtxoType::Transact,
        );

        assert_eq!(expected, decrypted);
    }
}

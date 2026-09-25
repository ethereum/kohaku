//! Sender-side view of a transact output.
//!
//! A post-transaction POI proof needs the note public key and value of every output, including
//! the ones sent to somebody else. When the operation was built by this process they come from
//! the builder; when the wallet is restored from its keys they have to be recovered from chain
//! data, which the sender can do with the shared key derived from the blinded receiver key.

use std::sync::Arc;

use alloy::primitives::U256;
use crypto::poseidon_hash;
use serde::{Deserialize, Serialize};

use crate::{
    account::signer::RailgunSigner,
    crypto::keys::{BlindedKey, ByteKey, U256Key},
    indexer::syncer,
    note::utxo::NoteError,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SentNote {
    pub tree_number: u32,
    pub leaf_index: u32,
    pub hash: U256,
    pub note_public_key: U256,
    pub value: u128,
    pub token_hash: U256,
}

impl SentNote {
    /// Decrypts a transact commitment as its sender.
    ///
    /// Returns `Ok(None)` when the ciphertext opens but no receiver master key candidate
    /// reproduces the on-chain commitment hash.
    pub fn decrypt(
        signer: &Arc<dyn RailgunSigner>,
        transact: &syncer::Transact,
    ) -> Result<Option<Self>, NoteError> {
        let blinded_receiver = BlindedKey::from_bytes(transact.blinded_receiver_viewing_key);
        let shared_key = signer
            .viewing_key()
            .derive_shared_key_blinded(blinded_receiver)?;

        // iv (16) | tag (16), encoded master public key (32), token hash (32),
        // random (16) | value (16), memo
        let bundle = shared_key.decrypt_gcm(&transact.ciphertext)?;
        if bundle.len() < 3 || bundle[0].len() != 32 || bundle[1].len() != 32 || bundle[2].len() != 32
        {
            return Ok(None);
        }

        let encoded_mpk = U256::from_be_slice(&bundle[0]);
        let token_hash = U256::from_be_slice(&bundle[1]);
        let random = U256::from_be_slice(&bundle[2][..16]);
        let mut value_bytes = [0u8; 16];
        value_bytes.copy_from_slice(&bundle[2][16..]);
        let value = u128::from_be_bytes(value_bytes);

        // The Railgun engine stores receiver XOR sender unless the sender is hidden; kohaku
        // stores the receiver key as is. The commitment hash tells which one applies.
        let sender_mpk = signer.address().master_key().to_u256();
        for receiver_mpk in [encoded_mpk, encoded_mpk ^ sender_mpk] {
            let Ok(npk) = poseidon_hash(&[receiver_mpk, random]) else {
                continue;
            };
            let Ok(hash) = poseidon_hash(&[npk, token_hash, U256::from(value)]) else {
                continue;
            };
            if hash == transact.hash {
                return Ok(Some(SentNote {
                    tree_number: transact.tree_number,
                    leaf_index: transact.leaf_index,
                    hash,
                    note_public_key: npk,
                    value,
                    token_hash,
                }));
            }
        }
        Ok(None)
    }
}

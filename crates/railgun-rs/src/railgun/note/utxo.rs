use std::{
    fmt::{Debug, Display},
    sync::Arc,
};

use crypto::poseidon_hash;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    abis::railgun::{TokenData, TokenDataError},
    caip::AssetId,
    crypto::{
        aes::AesError,
        keys::{
            BlindedKey, ByteKey, KeyError, MasterPublicKey, NullifyingKey, SpendingPublicKey,
            U256Key, ViewingPublicKey,
        },
    },
    railgun::{indexer, merkle_tree::UtxoLeafHash, note::Note, signer::Signer},
};

/// Railgun UTXO note
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct UtxoNote {
    pub tree_number: u32,
    pub leaf_index: u32,
    pub spending_pubkey: SpendingPublicKey,
    pub viewing_pubkey: ViewingPublicKey,

    pub random: [u8; 16],
    pub value: u128,
    pub asset: AssetId,
    pub memo: String,
    pub utxo_type: UtxoType,

    pub hash: UtxoLeafHash,
    pub nullifier: U256,
    pub note_public_key: U256,
    pub nullifying_key: NullifyingKey,
    pub blinded_commitment: U256,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum UtxoType {
    Shield,
    Transact,
}

#[derive(Debug, Error)]
pub enum NoteError {
    #[error("AES error: {0}")]
    Aes(#[from] AesError),
    #[error("TokenData error: {0}")]
    TokenData(#[from] TokenDataError),
    #[error("Key error: {0}")]
    Key(#[from] KeyError),
}

impl UtxoNote {
    pub fn new(
        tree_number: u32,
        leaf_index: u32,
        signer: Arc<dyn Signer>,
        asset: AssetId,
        value: u128,
        random: [u8; 16],
        memo: &str,
        utxo_type: UtxoType,
    ) -> Self {
        let spending_pubkey = signer.as_ref().spending_key().public_key();
        let nullifying_key = signer.viewing_key().nullifying_key();
        let nullifier = poseidon_hash(&[nullifying_key.to_u256(), U256::from(leaf_index)]).unwrap();
        let npk = note_public_key(spending_pubkey, nullifying_key, &random);
        let hash = note_hash(npk, asset, value);
        let blinded_commitment = blinded_commitment(hash.into(), npk, tree_number, leaf_index);

        UtxoNote {
            tree_number,
            leaf_index,
            spending_pubkey,
            viewing_pubkey: signer.as_ref().viewing_key().public_key(),
            asset,
            value,
            random,
            memo: memo.to_string(),
            utxo_type,
            hash,
            note_public_key: npk,
            nullifying_key,
            nullifier,
            blinded_commitment,
        }
    }

    /// Decrypt a transact note into a Note
    pub fn decrypt_transact(
        signer: Arc<dyn Signer>,
        transact: &indexer::Transact,
    ) -> Result<Self, NoteError> {
        let blinded_sender = BlindedKey::from_bytes(transact.blinded_sender_viewing_key);
        let shared_key = signer
            .viewing_key()
            .derive_shared_key_blinded(blinded_sender)?;

        // iv (16) | tag (16)
        // token_hash (32)
        // random (16) | value (16)
        // memo (optional)
        let bundle = shared_key.decrypt_gcm(&transact.ciphertext)?;
        let token_data = TokenData::from_hash(&bundle[1])?;
        let asset_id = AssetId::from(token_data);

        let mut random = [0u8; 16];
        random.copy_from_slice(&bundle[2][..16]);

        let mut value_bytes = [0u8; 16];
        value_bytes.copy_from_slice(&bundle[2][16..]);
        let value = u128::from_be_bytes(value_bytes);

        let memo = if bundle.len() > 3 {
            std::str::from_utf8(&bundle[3]).unwrap_or("")
        } else {
            ""
        };

        Ok(UtxoNote::new(
            transact.tree_number,
            transact.leaf_index,
            signer,
            asset_id,
            value,
            random,
            memo,
            UtxoType::Transact,
        ))
    }

    /// Decrypts a shield note into a Note
    pub fn decrypt_shield(
        signer: Arc<dyn Signer>,
        shield: &indexer::Shield,
    ) -> Result<Self, NoteError> {
        let shield_key = ViewingPublicKey::from_bytes(shield.shield_key);
        let shared_key = signer.viewing_key().derive_shared_key(shield_key)?;

        let decrypted = shared_key.decrypt_gcm(&shield.ciphertext)?;
        let asset_id = shield.token;
        let value = shield.value;

        let mut random = [0u8; 16];
        random.copy_from_slice(&decrypted[0][..16]);

        Ok(UtxoNote::new(
            shield.tree_number,
            shield.leaf_index,
            signer,
            asset_id,
            value.saturating_to(),
            random,
            "",
            UtxoType::Shield,
        ))
    }
}

impl Note for UtxoNote {
    fn asset(&self) -> AssetId {
        self.asset
    }

    fn value(&self) -> u128 {
        self.value
    }

    fn memo(&self) -> String {
        self.memo.clone()
    }

    fn random(&self) -> [u8; 16] {
        self.random
    }

    fn hash(&self) -> UtxoLeafHash {
        self.hash
    }

    fn note_public_key(&self) -> U256 {
        self.note_public_key
    }
}

impl UtxoNote {
    pub fn utxo_type(&self) -> UtxoType {
        self.utxo_type
    }
}

impl Display for UtxoNote {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "UtxoNote {{ tree_number: {}, leaf_index: {}, asset: {}, value: {}, memo: {}, utxo_type: {:?} }}",
            self.tree_number, self.leaf_index, self.asset, self.value, self.memo, self.utxo_type
        )
    }
}

fn note_hash(note_public_key: U256, asset: AssetId, value: u128) -> UtxoLeafHash {
    poseidon_hash(&[note_public_key, asset.hash(), U256::from(value)])
        .unwrap()
        .into()
}

fn note_public_key(
    spending_pubkey: SpendingPublicKey,
    nullifying_key: NullifyingKey,
    random: &[u8; 16],
) -> U256 {
    let master_key = MasterPublicKey::new(spending_pubkey, nullifying_key);

    poseidon_hash(&[master_key.to_u256(), U256::from_be_slice(random)]).unwrap()
}

fn blinded_commitment(hash: U256, npk: U256, tree_number: u32, leaf_index: u32) -> U256 {
    poseidon_hash(&[
        hash,
        npk,
        U256::from((tree_number as u128) * 65536 + (leaf_index as u128)),
    ])
    .unwrap()
}

#[cfg(test)]
pub fn test_note() -> UtxoNote {
    use crate::{
        crypto::keys::{SpendingKey, ViewingKey},
        railgun::signer::PrivateKeySigner,
    };

    let signer = PrivateKeySigner::new_evm(
        SpendingKey::from_bytes([1u8; 32]),
        ViewingKey::from_bytes([2u8; 32]),
        1,
    );
    UtxoNote::new(
        1,
        0,
        signer,
        AssetId::Erc20(alloy::primitives::address!(
            "0x1234567890123456789012345678901234567890"
        )),
        100u128,
        [3u8; 16],
        "test memo",
        UtxoType::Transact,
    )
}

#[cfg(test)]
mod tests {
    use tracing_test::traced_test;

    use super::*;

    #[test]
    #[traced_test]
    fn test_note_hash() {
        let note = test_note();
        let hash: U256 = note.hash().into();

        insta::assert_debug_snapshot!(hash);
    }

    #[test]
    #[traced_test]
    fn test_note_spending_pubkey() {
        let note = test_note();
        let pub_key = note.spending_pubkey;

        insta::assert_debug_snapshot!(pub_key);
    }

    #[test]
    #[traced_test]
    fn test_note_nullifier() {
        let note = test_note();
        let nullifier = note.nullifier;

        insta::assert_debug_snapshot!(nullifier);
    }

    #[test]
    #[traced_test]
    fn test_note_nullifying_key() {
        let note = test_note();
        let nullifying_key = note.nullifying_key;

        insta::assert_debug_snapshot!(nullifying_key);
    }

    #[test]
    #[traced_test]
    fn test_note_public_key() {
        let note = test_note();
        let pub_key = note.note_public_key;

        insta::assert_debug_snapshot!(pub_key);
    }
}

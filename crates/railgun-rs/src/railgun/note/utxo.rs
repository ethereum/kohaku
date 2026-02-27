use std::{fmt::Debug, sync::Arc};

use crypto::poseidon_hash;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::info;

use crate::{
    abis::railgun::{CommitmentCiphertext, ShieldRequest, TokenData, TokenDataError},
    caip::AssetId,
    crypto::{
        aes::{AesError, Ciphertext},
        keys::{
            BlindedKey, ByteKey, KeyError, MasterPublicKey, SpendingPublicKey, U256Key,
            ViewingPublicKey,
        },
    },
    railgun::{
        merkle_tree::UtxoLeafHash,
        note::{IncludedNote, Note, SignableNote},
        signer::{Signer, SpendingKeyProvider, ViewingKeyProvider},
    },
};

/// Railgun UTXO note
#[derive(Clone, Serialize, Deserialize)]
pub struct UtxoNote<S = Arc<dyn Signer>> {
    tree_number: u32,
    leaf_index: u32,
    spending_pubkey: SpendingPublicKey,
    viewing_pubkey: ViewingPublicKey,

    random: [u8; 16],
    value: u128,
    asset: AssetId,
    memo: String,
    utxo_type: UtxoType,

    hash: UtxoLeafHash,
    npk: U256,
    nullifying_key: U256,
    blinded_commitment: U256,

    #[serde(skip)]
    signer: S,
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

impl UtxoNote<Arc<dyn Signer>> {
    pub fn new(
        tree_number: u32,
        leaf_index: u32,
        signer: Arc<dyn Signer>,
        asset: AssetId,
        value: u128,
        random: [u8; 16],
        memo: &str,
        type_: UtxoType,
    ) -> Self {
        let note_hash = note_hash(signer.as_ref(), signer.as_ref(), asset, value, &random);
        let npk = note_public_key(signer.as_ref(), signer.as_ref(), &random);
        let nullifying_key = nullifying_key(signer.as_ref());
        let blinded_commitment = blinded_commitment(note_hash.into(), npk, tree_number, leaf_index);
        info!(
            "Creating note: tree_number={}, leaf_index={}, hash={:?}, npk={}, blinded_commitment={}",
            tree_number, leaf_index, note_hash, npk, blinded_commitment
        );

        UtxoNote {
            tree_number,
            leaf_index,
            spending_pubkey: signer.as_ref().spending_key().public_key(),
            viewing_pubkey: signer.as_ref().viewing_key().public_key(),
            asset,
            value,
            random,
            memo: memo.to_string(),
            utxo_type: type_,
            hash: note_hash,
            npk,
            nullifying_key,
            blinded_commitment,
            signer,
        }
    }

    /// Decrypt a note
    pub fn decrypt(
        signer: Arc<dyn Signer>,
        tree_number: u32,
        leaf_index: u32,
        encrypted: &CommitmentCiphertext,
    ) -> Result<Self, NoteError> {
        let blinded_sender = BlindedKey::from_bytes(encrypted.blindedSenderViewingKey.into());
        let shared_key = signer
            .viewing_key()
            .derive_shared_key_blinded(blinded_sender)?;

        let data: Vec<Vec<u8>> = vec![
            encrypted.ciphertext[1].to_vec(),
            encrypted.ciphertext[2].to_vec(),
            encrypted.ciphertext[3].to_vec(),
            encrypted.memo.to_vec(),
        ];

        let mut iv = [0u8; 16];
        let mut tag = [0u8; 16];

        iv.copy_from_slice(&encrypted.ciphertext[0][..16]);
        tag.copy_from_slice(&encrypted.ciphertext[0][16..]);

        let ciphertext = Ciphertext { iv, tag, data };

        // iv (16) | tag (16)
        // master_public_key (32)
        // token_hash (32)
        // random (16) | value (16)
        let bundle = shared_key.decrypt_gcm(&ciphertext)?;

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
            tree_number,
            leaf_index,
            signer,
            asset_id,
            value,
            random,
            memo,
            UtxoType::Transact,
        ))
    }

    /// Decrypts a shield note into a Note
    pub fn decrypt_shield_request(
        signer: Arc<dyn Signer>,
        tree_number: u32,
        leaf_index: u32,
        req: ShieldRequest,
    ) -> Result<Self, NoteError> {
        let encrypted_bundle: [[u8; 32]; 3] = [
            req.ciphertext.encryptedBundle[0].into(),
            req.ciphertext.encryptedBundle[1].into(),
            req.ciphertext.encryptedBundle[2].into(),
        ];

        let shield_key = ViewingPublicKey::from_bytes(req.ciphertext.shieldKey.into());
        let shared_key = signer.viewing_key().derive_shared_key(shield_key)?;

        let mut iv = [0u8; 16];
        let mut tag = [0u8; 16];
        iv.copy_from_slice(&encrypted_bundle[0][..16]);
        tag.copy_from_slice(&encrypted_bundle[0][16..]);

        let ciphertext = Ciphertext {
            iv,
            tag,
            data: vec![encrypted_bundle[1][..16].to_vec()],
        };
        let decrypted = shared_key.decrypt_gcm(&ciphertext)?;

        let asset_id = AssetId::from(req.preimage.token.clone());
        let value = req.preimage.value.saturating_to();

        let mut random = [0u8; 16];
        random.copy_from_slice(&decrypted[0][..16]);

        Ok(UtxoNote::new(
            tree_number,
            leaf_index,
            signer,
            asset_id,
            value,
            random,
            "",
            UtxoType::Shield,
        ))
    }

    pub fn without_signer(&self) -> UtxoNote<()> {
        UtxoNote {
            tree_number: self.tree_number,
            leaf_index: self.leaf_index,
            spending_pubkey: self.spending_pubkey,
            viewing_pubkey: self.viewing_pubkey,
            asset: self.asset,
            value: self.value,
            random: self.random,
            memo: self.memo.clone(),
            utxo_type: self.utxo_type,
            hash: self.hash,
            npk: self.npk,
            nullifying_key: self.nullifying_key,
            blinded_commitment: self.blinded_commitment,
            signer: (),
        }
    }
}

impl<S> Note for UtxoNote<S> {
    fn asset(&self) -> AssetId {
        self.asset
    }

    fn value(&self) -> u128 {
        self.value
    }

    fn memo(&self) -> String {
        self.memo.clone()
    }

    fn hash(&self) -> UtxoLeafHash {
        self.hash
    }

    fn note_public_key(&self) -> U256 {
        self.npk
    }
}

impl<S> IncludedNote for UtxoNote<S> {
    fn tree_number(&self) -> u32 {
        self.tree_number
    }

    fn leaf_index(&self) -> u32 {
        self.leaf_index
    }

    fn viewing_pubkey(&self) -> ViewingPublicKey {
        self.viewing_pubkey
    }

    /// Returns the note's nullifier for a given leaf index
    ///
    /// Hash of (nullifying_key, leaf_index)
    fn nullifier(&self, leaf_index: U256) -> U256 {
        poseidon_hash(&[self.nullifying_key, leaf_index]).unwrap()
    }

    fn random(&self) -> [u8; 16] {
        self.random
    }

    fn spending_pubkey(&self) -> [U256; 2] {
        [self.spending_pubkey.x_u256(), self.spending_pubkey.y_u256()]
    }

    fn nullifying_key(&self) -> U256 {
        self.nullifying_key
    }

    fn blinded_commitment(&self) -> U256 {
        self.blinded_commitment
    }
}

impl<S> UtxoNote<S> {
    pub fn utxo_type(&self) -> UtxoType {
        self.utxo_type
    }
}

impl SignableNote for UtxoNote<Arc<dyn Signer>> {
    fn sign(&self, inputs: &[U256]) -> [U256; 3] {
        let sig_hash = poseidon_hash(inputs).unwrap();
        let signature = self.signer.sign(sig_hash);
        [signature.r8_x, signature.r8_y, signature.s]
    }
}

impl<S> Debug for UtxoNote<S> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UtxoNote")
            .field("tree_number", &self.tree_number)
            .field("leaf_index", &self.leaf_index)
            .field("asset", &self.asset)
            .field("value", &self.value)
            .field("random", &self.random)
            .field("memo", &self.memo)
            .field("type", &self.utxo_type)
            .field("hash", &self.hash)
            .field("npk", &self.npk)
            .field("nullifying_key", &self.nullifying_key)
            .field("blinded_commitment", &self.blinded_commitment)
            .finish()
    }
}

impl PartialEq for UtxoNote<()> {
    fn eq(&self, other: &Self) -> bool {
        self.tree_number == other.tree_number
            && self.leaf_index == other.leaf_index
            && self.hash == other.hash
    }
}

impl Eq for UtxoNote<()> {}

impl PartialEq for UtxoNote<Arc<dyn Signer>> {
    fn eq(&self, other: &Self) -> bool {
        self.tree_number == other.tree_number
            && self.leaf_index == other.leaf_index
            && self.hash == other.hash
            && self.signer.viewing_key() == other.signer.viewing_key()
            && self.signer.spending_key() == other.signer.spending_key()
    }
}

impl Eq for UtxoNote<Arc<dyn Signer>> {}

fn note_hash(
    sk: &dyn SpendingKeyProvider,
    vk: &dyn ViewingKeyProvider,
    asset: AssetId,
    value: u128,
    random: &[u8; 16],
) -> UtxoLeafHash {
    poseidon_hash(&[
        note_public_key(sk, vk, random),
        asset.hash(),
        U256::from(value),
    ])
    .unwrap()
    .into()
}

fn note_public_key(
    sk: &dyn SpendingKeyProvider,
    vk: &dyn ViewingKeyProvider,
    random: &[u8; 16],
) -> U256 {
    let master_key = MasterPublicKey::new(
        sk.spending_key().public_key(),
        vk.viewing_key().nullifying_key(),
    );

    poseidon_hash(&[master_key.to_u256(), U256::from_be_slice(random)]).unwrap()
}

fn nullifying_key(vk: &dyn ViewingKeyProvider) -> U256 {
    poseidon_hash(&[vk.viewing_key().to_u256()]).unwrap()
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
pub fn test_note() -> UtxoNote<Arc<dyn Signer>> {
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
    fn test_note_sign() {
        let note = test_note();
        let msg = U256::from_be_slice(&[4u8; 32]);
        let signature = note.sign(&[msg]);

        insta::assert_debug_snapshot!(signature);
    }

    #[test]
    #[traced_test]
    fn test_note_spending_pubkey() {
        let note = test_note();
        let pub_key = note.spending_pubkey();

        insta::assert_debug_snapshot!(pub_key);
    }

    #[test]
    #[traced_test]
    fn test_note_nullifier() {
        let note = test_note();
        let leaf_index = U256::from(5u32);
        let nullifier = note.nullifier(leaf_index);

        insta::assert_debug_snapshot!(nullifier);
    }

    #[test]
    #[traced_test]
    fn test_note_nullifying_key() {
        let note = test_note();
        let nullifying_key = note.nullifying_key();

        insta::assert_debug_snapshot!(nullifying_key);
    }

    #[test]
    #[traced_test]
    fn test_note_public_key() {
        let note = test_note();
        let pub_key = note.note_public_key();

        insta::assert_debug_snapshot!(pub_key);
    }
}

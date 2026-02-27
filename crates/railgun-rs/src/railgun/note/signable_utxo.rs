use std::{fmt::Debug, sync::Arc};

use ruint::aliases::U256;

use crate::{
    caip::AssetId,
    crypto::{keys::ViewingPublicKey, poseidon::poseidon_hash},
    railgun::{
        merkle_tree::UtxoLeafHash,
        note::{IncludedNote, Note, SignableNote, utxo::UtxoNote},
        signer::Signer,
    },
};

/// Signable railgun UTXO note
#[derive(Clone)]
pub struct SignableUtxoNote {
    inner: UtxoNote,
    signer: Arc<dyn Signer>,
}

impl SignableUtxoNote {}

impl Note for SignableUtxoNote {
    fn asset(&self) -> AssetId {
        self.inner.asset()
    }
    fn value(&self) -> u128 {
        self.inner.value()
    }
    fn memo(&self) -> String {
        self.inner.memo()
    }
    fn hash(&self) -> UtxoLeafHash {
        self.inner.hash()
    }
    fn note_public_key(&self) -> U256 {
        self.inner.note_public_key()
    }
}

impl IncludedNote for SignableUtxoNote {
    fn tree_number(&self) -> u32 {
        self.inner.tree_number()
    }
    fn leaf_index(&self) -> u32 {
        self.inner.leaf_index()
    }
    fn spending_pubkey(&self) -> [U256; 2] {
        self.inner.spending_pubkey()
    }
    fn viewing_pubkey(&self) -> ViewingPublicKey {
        self.inner.viewing_pubkey()
    }
    fn nullifying_key(&self) -> U256 {
        self.inner.nullifying_key()
    }
    fn nullifier(&self, leaf_index: U256) -> U256 {
        self.inner.nullifier(leaf_index)
    }
    fn random(&self) -> [u8; 16] {
        self.inner.random()
    }
    fn blinded_commitment(&self) -> U256 {
        self.inner.blinded_commitment()
    }
}

impl SignableNote for SignableUtxoNote {
    fn sign(&self, inputs: &[U256]) -> [U256; 3] {
        let sig_hash = poseidon_hash(inputs).unwrap();
        let signature = self.signer.sign(sig_hash);
        [signature.r8_x, signature.r8_y, signature.s]
    }
}

impl Debug for SignableUtxoNote {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SignableUtxoNote")
            .field("signer", &self.signer.address())
            .field("note", &self.inner)
            .finish()
    }
}

impl PartialEq for SignableUtxoNote {
    fn eq(&self, other: &Self) -> bool {
        self.inner == other.inner
            && self.signer.viewing_key() == other.signer.viewing_key()
            && self.signer.spending_key() == other.signer.spending_key()
    }
}

impl Eq for SignableUtxoNote {}

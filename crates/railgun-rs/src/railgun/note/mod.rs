use rand::RngCore;
use ruint::aliases::U256;

use crate::{
    abis::railgun::CommitmentCiphertext,
    caip::AssetId,
    railgun::{merkle_tree::UtxoLeafHash, note::encrypt::EncryptError},
};

pub mod encrypt;
pub mod operation;
pub mod transfer;
pub mod unshield;
pub mod utxo;

pub trait EncryptableNote: Note {
    fn encrypt(&self, rng: &mut dyn RngCore) -> Result<CommitmentCiphertext, EncryptError>;
}

pub trait Note {
    fn asset(&self) -> AssetId;
    fn value(&self) -> u128;
    fn memo(&self) -> String;

    /// Commitment Hash
    fn hash(&self) -> UtxoLeafHash;

    /// NPK
    fn note_public_key(&self) -> U256;
}

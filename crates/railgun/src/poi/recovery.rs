//! Inputs for rebuilding post-transaction POI proofs of past operations.

use crate::{
    crypto::keys::{NullifyingKey, SpendingPublicKey},
    note::{sent::SentNote, utxo::UtxoNote},
};

/// Everything one registered account knows about its own history.
pub struct RecoveryAccount {
    pub spending_pubkey: SpendingPublicKey,
    pub(crate) nullifying_key: NullifyingKey,
    pub unspent: Vec<UtxoNote>,
    pub spent: Vec<UtxoNote>,
    pub sent: Vec<SentNote>,
}

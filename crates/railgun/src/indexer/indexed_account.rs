use std::sync::Arc;

use alloy::primitives::U256;
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::{
    account::{address::RailgunAddress, signer::RailgunSigner},
    indexer::syncer,
    note::{
        sent::SentNote,
        utxo::{NoteError, UtxoNote},
    },
};

/// IndexerAccount represents a Railgun account being tracked by the indexer.
///
/// The indexer will use the contained signer to decrypt notes and track the
/// account's balance and UTXOs.
pub struct IndexedAccount {
    signer: Arc<dyn RailgunSigner>,
    inner: IndexedAccountState,
}

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct IndexedAccountState {
    pub notes: Vec<UtxoNote>,
    pub synced_block: u64,
    /// Notes this account has spent. Needed to rebuild a POI proof for an
    /// operation that was not built by this process (wallet restored from keys).
    #[serde(default)]
    pub spent: Vec<UtxoNote>,
    /// Outputs this account sent to other addresses.
    #[serde(default)]
    pub sent: Vec<SentNote>,
}

impl IndexedAccount {
    pub fn from_state(signer: Arc<dyn RailgunSigner>, state: IndexedAccountState) -> Self {
        IndexedAccount {
            signer,
            inner: state,
        }
    }

    pub fn state(&self) -> IndexedAccountState {
        self.inner.clone()
    }

    pub fn address(&self) -> RailgunAddress {
        self.signer.address()
    }

    /// Returns all unspent notes for this account.
    pub fn unspent(&self) -> Vec<UtxoNote> {
        self.inner.notes.clone()
    }

    /// Notes spent by this account.
    pub fn spent(&self) -> Vec<UtxoNote> {
        self.inner.spent.clone()
    }

    /// Outputs sent by this account to other addresses.
    pub fn sent(&self) -> Vec<SentNote> {
        self.inner.sent.clone()
    }

    pub fn signer(&self) -> Arc<dyn RailgunSigner> {
        self.signer.clone()
    }

    /// Returns the latest synced block for this account.
    pub fn synced_block(&self) -> u64 {
        self.inner.synced_block
    }

    pub fn set_synced_block(&mut self, block: u64) {
        self.inner.synced_block = block;
    }

    pub fn handle_shield_event(&mut self, event: &syncer::Shield) -> Result<(), NoteError> {
        let note = UtxoNote::decrypt_shield(self.signer.clone(), event);
        let note = match note {
            Err(NoteError::Aes(_)) => {
                return Ok(());
            }
            Err(e) => {
                debug!(
                    "Failed to decrypt Shield note at tree {}, leaf {}: {}",
                    event.tree_number, event.leaf_index, e
                );
                return Ok(());
            }
            Ok(n) => n,
        };

        info!(?note, "Decrypted Shield Note");
        self.inner.notes.push(note);

        Ok(())
    }

    pub fn handle_transact_event(&mut self, event: &syncer::Transact) -> Result<(), NoteError> {
        let note = UtxoNote::decrypt_transact(self.signer.clone(), &event);

        let note = match note {
            Err(NoteError::Aes(_)) => {
                // Not addressed to us. It may still be one of our own outputs.
                if let Ok(Some(sent)) = SentNote::decrypt(&self.signer, event) {
                    debug!(
                        "Decrypted sent note at tree {}, leaf {}",
                        sent.tree_number, sent.leaf_index
                    );
                    self.inner.sent.push(sent);
                }
                return Ok(());
            }
            Err(e) => {
                debug!(
                    "Failed to decrypt Transact note at tree {}, leaf {}: {}",
                    event.tree_number, event.leaf_index, e
                );
                return Ok(());
            }
            Ok(n) => n,
        };

        info!(?note, "Decrypted Transact Note");
        self.inner.notes.push(note);

        Ok(())
    }

    pub fn handle_nullified_event(&mut self, event: &syncer::Nullified, _timestamp: u64) {
        let nullifier: U256 = event.nullifier.into();
        let (spent, kept): (Vec<_>, Vec<_>) = std::mem::take(&mut self.inner.notes)
            .into_iter()
            .partition(|note| note.tree_number == event.tree_number && note.nullifier == nullifier);
        self.inner.notes = kept;
        self.inner.spent.extend(spent);
    }
}

#[cfg(test)]
mod tests {
    use alloy::primitives::address;
    use rand::random;

    use super::*;
    use crate::{
        account::signer::PrivateKeySigner,
        caip::AssetId,
        note::{EncryptableNote, Note, encrypt::encrypt_shield, transfer::TransferNote},
    };

    /// The sender recovers npk and value of an output addressed to someone else,
    /// and spent notes are kept instead of dropped.
    #[test]
    fn test_sent_and_spent_tracking() {
        let sender = PrivateKeySigner::new_evm(random(), random(), 1);
        let recipient = PrivateKeySigner::new_evm(random(), random(), 1);
        let asset = AssetId::erc20(address!("0xDEADDEADDEADDEADDEADDEADDEADDEADDEADDEAD"));
        let rng = &mut rand::rng();
        let mut account = IndexedAccount {
            signer: sender.clone(),
            inner: Default::default(),
        };

        let outgoing = TransferNote::new(
            sender.viewing_key(),
            recipient.address(),
            asset,
            42,
            random(),
            "out",
        );
        let ciphertext = outgoing.encrypt(rng).unwrap();
        let event = syncer::Transact {
            tree_number: 0,
            leaf_index: 7,
            hash: outgoing.hash().into(),
            ciphertext: ciphertext.clone().into(),
            blinded_sender_viewing_key: *ciphertext.blindedSenderViewingKey,
            blinded_receiver_viewing_key: *ciphertext.blindedReceiverViewingKey,
            annotation_data: ciphertext.annotationData.to_vec(),
        };
        account.handle_transact_event(&event).unwrap();

        assert!(account.unspent().is_empty());
        let sent = account.sent();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].value, 42);
        assert_eq!(sent[0].leaf_index, 7);
        assert_eq!(sent[0].token_hash, asset.hash());
        assert_eq!(sent[0].note_public_key, outgoing.note_public_key());
        assert_eq!(sent[0].hash, <U256 as From<_>>::from(outgoing.hash()));

        // A note of a third party is neither received nor sent.
        let third = PrivateKeySigner::new_evm(random(), random(), 1);
        let foreign = TransferNote::new(third.viewing_key(), recipient.address(), asset, 1, random(), "");
        let ct = foreign.encrypt(rng).unwrap();
        account
            .handle_transact_event(&syncer::Transact {
                tree_number: 0,
                leaf_index: 8,
                hash: foreign.hash().into(),
                ciphertext: ct.clone().into(),
                blinded_sender_viewing_key: *ct.blindedSenderViewingKey,
                blinded_receiver_viewing_key: *ct.blindedReceiverViewingKey,
                annotation_data: ct.annotationData.to_vec(),
            })
            .unwrap();
        assert_eq!(account.sent().len(), 1);

        // Change note to self, then spent: moves to `spent`.
        let change = TransferNote::new(sender.viewing_key(), sender.address(), asset, 5, random(), "");
        let ct = change.encrypt(rng).unwrap();
        account
            .handle_transact_event(&syncer::Transact {
                tree_number: 0,
                leaf_index: 9,
                hash: change.hash().into(),
                ciphertext: ct.clone().into(),
                blinded_sender_viewing_key: *ct.blindedSenderViewingKey,
                blinded_receiver_viewing_key: *ct.blindedReceiverViewingKey,
                annotation_data: ct.annotationData.to_vec(),
            })
            .unwrap();
        let note = account.unspent().pop().unwrap();
        account.handle_nullified_event(
            &syncer::Nullified {
                tree_number: 0,
                nullifier: note.nullifier.into(),
            },
            0,
        );
        assert!(account.unspent().is_empty());
        assert_eq!(account.spent().len(), 1);
        assert_eq!(account.spent()[0].leaf_index, 9);
    }

    #[test]
    fn test_event_handling() {
        let sender = PrivateKeySigner::new_evm(random(), random(), 1);
        let recipient = PrivateKeySigner::new_evm(random(), random(), 1);
        let other_recipient = PrivateKeySigner::new_evm(random(), random(), 1);
        let asset = AssetId::erc20(address!("0xDEADDEADDEADDEADDEADDEADDEADDEADDEADDEAD"));
        let value = 100;
        let rng = &mut rand::rng();
        let mut account = IndexedAccount {
            signer: recipient.clone(),
            inner: Default::default(),
        };

        // Ingest a shield note
        let shield = encrypt_shield(recipient.address(), asset, value, rng).unwrap();
        let event = syncer::Shield {
            tree_number: 1,
            leaf_index: 0,
            npk: shield.preimage.npk.into(),
            token: shield.preimage.token.try_into().unwrap(),
            value: U256::from(shield.preimage.value),
            ciphertext: shield.ciphertext.clone().into(),
            shield_key: *shield.ciphertext.shieldKey,
            hash: None,
        };

        account.handle_shield_event(&event).unwrap();
        let notes = account.unspent();
        assert_eq!(notes.len(), 1);

        let note = &notes[0];
        assert_eq!(note.tree_number, 1);
        assert_eq!(note.leaf_index, 0);
        assert_eq!(note.asset, asset);
        assert_eq!(note.value, value);

        // Ingest a shield note for a different recipient
        let other_shield = encrypt_shield(other_recipient.address(), asset, value, rng).unwrap();
        let other_event = syncer::Shield {
            tree_number: 1,
            leaf_index: 1,
            npk: other_shield.preimage.npk.into(),
            token: other_shield.preimage.token.try_into().unwrap(),
            value: U256::from(other_shield.preimage.value),
            ciphertext: other_shield.ciphertext.clone().into(),
            shield_key: *other_shield.ciphertext.shieldKey,
            hash: None,
        };

        account.handle_shield_event(&other_event).unwrap();
        let notes = account.unspent();
        assert_eq!(notes.len(), 1); // Should still only have the first note

        // Ingest a transact note
        let memo = "Test transfer";
        let transact = TransferNote::new(
            sender.viewing_key(),
            recipient.address(),
            asset,
            value,
            random(),
            memo,
        );

        let ciphertext = transact.encrypt(rng).unwrap();
        let event = syncer::Transact {
            tree_number: 1,
            leaf_index: 2,
            hash: transact.hash().into(),
            ciphertext: ciphertext.clone().into(),
            blinded_sender_viewing_key: *ciphertext.blindedSenderViewingKey,
            blinded_receiver_viewing_key: *ciphertext.blindedReceiverViewingKey,
            annotation_data: ciphertext.annotationData.to_vec(),
        };

        account.handle_transact_event(&event).unwrap();
        let notes = account.unspent();
        assert_eq!(notes.len(), 2);

        let note = notes.iter().find(|n| n.leaf_index == 2).unwrap();
        assert_eq!(note.tree_number, 1);
        assert_eq!(note.leaf_index, 2);
        assert_eq!(note.asset, asset);
        assert_eq!(note.value, value);
        assert_eq!(note.memo, memo.to_string());

        // Ingest a nullifier for the transact
        let nullified_event = syncer::Nullified {
            tree_number: 1,
            nullifier: note.nullifier.into(),
        };

        account.handle_nullified_event(&nullified_event, 0);
        let notes = account.unspent();
        assert_eq!(notes.len(), 1);

        let remaining_note = &notes[0];
        assert_eq!(remaining_note.tree_number, 1);
        assert_eq!(remaining_note.leaf_index, 0);

        // Ingest a nullifier for an unrelated note
        let unrelated_nullified_event = syncer::Nullified {
            tree_number: 1,
            nullifier: U256::from(1234567890).into(),
        };

        account.handle_nullified_event(&unrelated_nullified_event, 0);
        let notes = account.unspent();
        assert_eq!(notes.len(), 1); // Should still have the original note
    }
}

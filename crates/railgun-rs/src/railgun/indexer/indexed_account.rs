use std::{collections::HashMap, sync::Arc};

use alloy::primitives::U256;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::railgun::{
    address::RailgunAddress,
    indexer::{self, syncer},
    note::utxo::{NoteError, UtxoNote},
    signer::RailgunSigner,
};

/// IndexerAccount represents a Railgun account being tracked by the indexer.
///
/// The indexer will use the contained signer to decrypt notes and track the
/// account's balance and UTXOs.
pub struct IndexedAccount {
    signer: Arc<dyn RailgunSigner>,
    notes: HashMap<(u32, u32), UtxoNote>, // Map of (tree_number, leaf_index) to UtxoNote
    pub synced_block: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct IndexedAccountState {
    pub notes: HashMap<(u32, u32), UtxoNote>,
    pub synced_block: u64,
}

impl IndexedAccount {
    pub fn new(signer: Arc<dyn RailgunSigner>, synced_block: u64) -> Self {
        IndexedAccount {
            signer,
            notes: HashMap::new(),
            synced_block,
        }
    }

    pub fn from_state(state: IndexedAccountState, signer: Arc<dyn RailgunSigner>) -> Self {
        IndexedAccount {
            signer,
            notes: state.notes,
            synced_block: state.synced_block,
        }
    }

    pub fn state(&self) -> IndexedAccountState {
        IndexedAccountState {
            notes: self.notes.clone(),
            synced_block: self.synced_block,
        }
    }

    pub fn address(&self) -> RailgunAddress {
        self.signer.address()
    }

    pub fn unspent(&self) -> Vec<UtxoNote> {
        self.notes.values().cloned().collect()
    }

    /// Handles a Shield event for this account.
    pub fn handle_shield_event(&mut self, event: &indexer::Shield) -> Result<(), NoteError> {
        let note = UtxoNote::decrypt_shield(self.signer.clone(), event);
        let note = match note {
            Err(NoteError::Aes(_)) => {
                return Ok(());
            }
            Err(e) => {
                warn!(
                    "Failed to decrypt Shield note at tree {}, leaf {}: {}",
                    event.tree_number, event.leaf_index, e
                );
                return Ok(());
            }
            Ok(n) => n,
        };

        info!(?note, "Decrypted Shield Note");
        self.notes
            .insert((event.tree_number, event.leaf_index), note);

        Ok(())
    }

    /// Handles a Transact event for this account.
    pub fn handle_transact_event(&mut self, event: &syncer::Transact) -> Result<(), NoteError> {
        let note = UtxoNote::decrypt_transact(self.signer.clone(), &event);

        let note = match note {
            Err(NoteError::Aes(_)) => {
                return Ok(());
            }
            Err(e) => {
                warn!(
                    "Failed to decrypt Transact note at tree {}, leaf {}: {}",
                    event.tree_number, event.leaf_index, e
                );
                return Ok(());
            }
            Ok(n) => n,
        };

        info!(?note, "Decrypted Transact Note");
        self.notes
            .insert((event.tree_number, event.leaf_index), note);

        Ok(())
    }

    /// Handles a nullified event for this account.
    pub fn handle_nullified_event(&mut self, event: &syncer::Nullified, _timestamp: u64) {
        let nullifier: U256 = event.nullifier.into();
        self.notes.retain(|(tree_number, _), note| {
            if *tree_number != event.tree_number {
                return true; // Keep notes from other trees
            }
            note.nullifier != nullifier // Keep notes that don't match the nullifier
        });
    }
}

#[cfg(test)]
mod tests {
    use alloy::primitives::address;
    use rand::random;

    use super::*;
    use crate::{
        caip::AssetId,
        railgun::{
            PrivateKeySigner,
            note::{EncryptableNote, Note, encrypt::encrypt_shield, transfer::TransferNote},
        },
    };

    #[test]
    fn test_event_handling() {
        let sender = PrivateKeySigner::new_evm(random(), random(), 1);
        let recipient = PrivateKeySigner::new_evm(random(), random(), 1);
        let other_recipient = PrivateKeySigner::new_evm(random(), random(), 1);
        let asset = AssetId::erc20(address!("0xDEADDEADDEADDEADDEADDEADDEADDEADDEADDEAD"));
        let value = 100;
        let rng = &mut rand::rng();
        let mut account = IndexedAccount::new(recipient.clone(), 0);

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
        };

        account.handle_shield_event(&other_event).unwrap();
        let notes = account.unspent();
        assert_eq!(notes.len(), 1); // Should still only have the first note

        // Ingest a transact note
        let memo = "Test transfer";
        let transact = TransferNote::new(
            sender.viewing_key,
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

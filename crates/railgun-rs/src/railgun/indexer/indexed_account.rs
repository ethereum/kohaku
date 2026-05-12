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

use std::{collections::HashMap, sync::Arc};

use alloy_primitives::U256;
use serde::{Deserialize, Serialize};
use tracing::{info, warn};

use crate::{
    caip::AssetId,
    railgun::{
        address::RailgunAddress,
        indexer::{self, syncer},
        note::{
            IncludedNote, Note,
            utxo::{NoteError, UtxoNote},
        },
        signer::Signer,
    },
};

/// IndexerAccount represents a Railgun account being tracked by the indexer.
///
/// The indexer will use the contained signer to decrypt notes and track the
/// account's balance and UTXOs.
pub struct IndexedAccount {
    signer: Arc<dyn Signer>,
    notes: HashMap<(u32, u32), UtxoNote>, // Map of (tree_number, leaf_index) to UtxoNote
    pub synced_block: u64,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct IndexedAccountState {
    pub notes: HashMap<(u32, u32), UtxoNote>,
    pub synced_block: u64,
}

impl IndexedAccount {
    pub fn new(signer: Arc<dyn Signer>, synced_block: u64) -> Self {
        IndexedAccount {
            signer,
            notes: HashMap::new(),
            synced_block,
        }
    }

    pub fn from_state(state: IndexedAccountState, signer: Arc<dyn Signer>) -> Self {
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

    /// Calculates the balance of the account by summing up the values of all its notes.
    pub fn balance(&self) -> HashMap<AssetId, u128> {
        let mut balances: HashMap<AssetId, u128> = HashMap::new();

        for (_, note) in self.notes.iter() {
            match note.asset() {
                AssetId::Erc20(address) => {
                    balances
                        .entry(AssetId::Erc20(address))
                        .and_modify(|e| *e += note.value())
                        .or_insert(note.value());
                }
                _ => todo!(),
            }
        }

        balances
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
            note.nullifier() != nullifier // Keep notes that don't match the nullifier
        });
    }
}

use std::{collections::HashMap, sync::Arc};

use tracing::{info, warn};

use crate::{
    caip::AssetId,
    railgun::{
        address::RailgunAddress,
        indexer::{self, notebook::Notebook, syncer},
        note::{
            Note,
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

    /// The latest block number that has been processed for this account
    notebooks: HashMap<u32, Notebook>,
}

impl IndexedAccount {
    pub fn new(signer: Arc<dyn Signer>) -> Self {
        IndexedAccount {
            signer,
            notebooks: HashMap::new(),
        }
    }

    pub fn address(&self) -> RailgunAddress {
        self.signer.address()
    }

    pub fn unspent(&self) -> Vec<UtxoNote> {
        let mut unspent = Vec::new();
        for notebook in self.notebooks.values() {
            unspent.extend(notebook.unspent().values().cloned());
        }
        unspent
    }

    /// Calculates the balance of the account by summing up the values of all its notes.
    pub fn balance(&self) -> HashMap<AssetId, u128> {
        let mut balances: HashMap<AssetId, u128> = HashMap::new();

        for (_, notebook) in self.notebooks.iter() {
            for (_, note) in notebook.unspent().iter() {
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
        }

        balances
    }

    /// Handles a Shield event for this account. Returns true if any new notes were added.
    pub fn handle_shield_event(&mut self, event: &indexer::Shield) -> Result<bool, NoteError> {
        let note = UtxoNote::decrypt_shield(self.signer.clone(), event);
        let note = match note {
            Err(NoteError::Aes(_)) => {
                return Ok(false);
            }
            Err(e) => {
                warn!(
                    "Failed to decrypt Shield note at tree {}, leaf {}: {}",
                    event.tree_number, event.leaf_index, e
                );
                return Ok(false);
            }
            Ok(n) => n,
        };

        info!(?note, "Decrypted Shield Note");
        self.notebooks
            .entry(event.tree_number)
            .or_default()
            .add(event.leaf_index, note);

        Ok(true)
    }

    /// Handles a Transact event for this account. Returns true if any new notes were added.
    pub fn handle_transact_event(&mut self, event: &syncer::Transact) -> Result<bool, NoteError> {
        let note = UtxoNote::decrypt_transact(self.signer.clone(), &event);

        let note = match note {
            Err(NoteError::Aes(_)) => {
                return Ok(false);
            }
            Err(e) => {
                warn!(
                    "Failed to decrypt Transact note at tree {}, leaf {}: {}",
                    event.tree_number, event.leaf_index, e
                );
                return Ok(false);
            }
            Ok(n) => n,
        };

        info!(?note, "Decrypted Transact Note");
        self.notebooks
            .entry(event.tree_number)
            .or_default()
            .add(event.leaf_index, note);

        Ok(true)
    }

    /// Handles a nullified event for this account. Returns true if any notes were nullified.
    pub fn handle_nullified_event(&mut self, event: &syncer::Nullified, timestamp: u64) -> bool {
        let spent = self
            .notebooks
            .entry(event.tree_number)
            .or_default()
            .nullify(event.nullifier.into(), timestamp);

        if spent.is_some() {
            info!("Nullified note");
            return true;
        }
        false
    }
}

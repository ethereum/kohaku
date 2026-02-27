use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

use ruint::aliases::U256;
use tracing::{info, warn};

use crate::{
    abis::railgun::{RailgunSmartWallet, ShieldRequest},
    caip::AssetId,
    railgun::{
        address::RailgunAddress,
        indexer::notebook::Notebook,
        merkle_tree::TOTAL_LEAVES,
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
    notebooks: BTreeMap<u32, Notebook>,
}

impl IndexedAccount {
    pub fn new(signer: Arc<dyn Signer>) -> Self {
        IndexedAccount {
            signer,
            notebooks: BTreeMap::new(),
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
    pub fn handle_shield_event(
        &mut self,
        event: &RailgunSmartWallet::Shield,
    ) -> Result<bool, NoteError> {
        let tree_number: u32 = event.treeNumber.saturating_to();
        let start_position: u32 = event.startPosition.saturating_to();

        let mut added = false;
        for (index, ciphertext) in event.shieldCiphertext.iter().enumerate() {
            let shield_request = ShieldRequest {
                preimage: event.commitments[index].clone(),
                ciphertext: ciphertext.clone(),
            };

            let is_crossing_tree = start_position as usize + index >= TOTAL_LEAVES;
            let index = index as u32;
            let (tree_number, leaf_index) = if is_crossing_tree {
                (
                    tree_number + 1,
                    start_position + index - TOTAL_LEAVES as u32,
                )
            } else {
                (tree_number, start_position + index)
            };

            let note = UtxoNote::decrypt_shield_request(
                self.signer.clone(),
                tree_number,
                leaf_index,
                shield_request,
            );

            let note = match note {
                Err(NoteError::Aes(_e)) => {
                    continue;
                }
                Err(e) => {
                    warn!(
                        "Failed to decrypt Shield note at tree {}, leaf {}: {}",
                        tree_number, leaf_index, e
                    );
                    continue;
                }
                Ok(n) => n,
            };

            info!(?note, "Decrypted Shield Note");
            self.notebooks
                .entry(tree_number)
                .or_default()
                .add(leaf_index, note);
            added = true;
        }

        Ok(added)
    }

    /// Handles a Transact event for this account. Returns true if any new notes were added.
    pub fn handle_transact_event(
        &mut self,
        event: &RailgunSmartWallet::Transact,
    ) -> Result<bool, NoteError> {
        let tree_number: u32 = event.treeNumber.saturating_to();
        let start_position: u32 = event.startPosition.saturating_to();

        let mut added = false;
        for (index, ciphertext) in event.ciphertext.iter().enumerate() {
            let is_crossing_tree = start_position as usize + index >= TOTAL_LEAVES;
            let index = index as u32;
            let (tree_number, leaf_index) = if is_crossing_tree {
                (
                    tree_number + 1,
                    start_position + index - TOTAL_LEAVES as u32,
                )
            } else {
                (tree_number, start_position + index)
            };

            let note = UtxoNote::decrypt(self.signer.clone(), tree_number, leaf_index, ciphertext);

            let note = match note {
                Err(NoteError::Aes(_)) => continue,
                Err(e) => {
                    warn!(
                        "Failed to decrypt Transact note at tree {}, leaf {}: {}",
                        tree_number, leaf_index, e
                    );
                    continue;
                }
                Ok(n) => n,
            };

            info!(?note, "Decrypted Transact Note");
            self.notebooks
                .entry(tree_number)
                .or_default()
                .add(leaf_index, note);
            added = true;
        }

        Ok(added)
    }

    /// Handles a nullified event for this account. Returns true if any notes were nullified.
    pub fn handle_nullified_event(
        &mut self,
        event: &RailgunSmartWallet::Nullified,
        timestamp: u64,
    ) -> bool {
        let tree_number: u32 = event.treeNumber as u32;

        let mut matched = false;
        for nullifier in event.nullifier.iter() {
            let spent = self
                .notebooks
                .entry(tree_number)
                .or_default()
                .nullify(U256::from_be_bytes(**nullifier), timestamp);

            if spent.is_some() {
                info!("Nullified note");
                matched = true;
            }
        }

        matched
    }
}

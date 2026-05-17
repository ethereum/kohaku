use std::{collections::BTreeMap, sync::Arc, u64};

use crypto::poseidon_hash;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::info;

use crate::{
    account::{address::RailgunAddress, signer::RailgunSigner},
    database::{Database, DatabaseError, RailgunDB},
    indexer::{
        indexed_account::IndexedAccount,
        syncer::{self, SyncEvent, SyncerError, UtxoSyncer},
    },
    merkle_tree::{MerkleTreeVerifier, UtxoLeafHash, UtxoMerkleTree},
    note::utxo::{NoteError, UtxoNote},
};

/// Utxo indexer that maintains the set of UTXO merkle trees and tracks accounts
/// and account notes / balances.
pub struct UtxoIndexer {
    synced_block: u64,
    pub utxo_trees: BTreeMap<u32, UtxoMerkleTree>,
    accounts: Vec<IndexedAccount>,

    db: Arc<dyn Database>,
    utxo_syncer: Arc<dyn UtxoSyncer>,
    utxo_verifier: Arc<dyn MerkleTreeVerifier>,
}

#[derive(Serialize, Deserialize, Default)]
pub(crate) struct UtxoIndexerState {
    pub synced_block: u64,
    pub trees: Vec<u32>,
}

#[derive(Debug, Error)]
pub enum UtxoIndexerError {
    #[error("Syncer error: {0}")]
    SyncerError(#[from] SyncerError),
    #[error("Verification error: {0}")]
    VerificationError(#[source] Box<dyn std::error::Error + 'static>),
    #[error("Note error: {0}")]
    NoteError(#[from] NoteError),
    #[error("Database error: {0}")]
    DatabaseError(#[from] DatabaseError),
    #[error("Timed out waiting for commitments")]
    Timeout,
}

impl UtxoIndexer {
    pub async fn new(
        db: Arc<dyn Database>,
        utxo_syncer: Arc<dyn UtxoSyncer>,
        utxo_verifier: Arc<dyn MerkleTreeVerifier>,
    ) -> Result<Self, UtxoIndexerError> {
        let state = db.get_utxo_indexer().await?;

        let mut utxo_trees = BTreeMap::new();
        for number in state.trees {
            let tree_state = db.get_utxo_tree(number).await?;
            if let Some(tree_state) = tree_state {
                utxo_trees.insert(number, UtxoMerkleTree::from_state(tree_state));
            }
        }

        Ok(UtxoIndexer {
            synced_block: state.synced_block,
            utxo_trees,
            accounts: vec![],
            db,
            utxo_syncer,
            utxo_verifier,
        })
    }

    /// Returns the latest synced block
    pub fn synced_block(&self) -> u64 {
        let mut min_synced = self.synced_block;
        for account in self.accounts.iter() {
            min_synced = min_synced.min(account.synced_block());
        }
        min_synced
    }

    /// Registers a signer with the indexer. The indexer will track UTXOs for the associated
    /// address.
    pub async fn register(
        &mut self,
        signer: Arc<dyn RailgunSigner>,
    ) -> Result<(), UtxoIndexerError> {
        let addr = signer.address();
        let state = self.db.get_account(&addr).await?;

        let account = IndexedAccount::from_state(signer, state);
        self.accounts.push(account);
        Ok(())
    }

    /// Lists all registered accounts
    pub fn registered(&self) -> Vec<RailgunAddress> {
        self.accounts.iter().map(|a| a.address()).collect()
    }

    /// Lists all unspent notes for a given address. Returns an empty list if the address is not
    /// registered.
    pub fn unspent(&self, address: RailgunAddress) -> Vec<UtxoNote> {
        for account in self.accounts.iter() {
            if account.address() == address {
                return account.unspent();
            }
        }

        vec![]
    }

    /// Syncs the indexer to a specific block. If the indexer is already synced past that block,
    /// this is a no-op.
    #[tracing::instrument(name = "utxo_sync", skip_all)]
    pub async fn sync_to(&mut self, to_block: u64) -> Result<(), UtxoIndexerError> {
        let from_block = self.synced_block() + 1;

        let latest_block = self.utxo_syncer.latest_block().await?;
        let to_block = to_block.min(latest_block);

        if from_block > to_block {
            return Ok(());
        }

        // Sync
        let events = self.utxo_syncer.sync(from_block, to_block).await?;
        info!("Fetched {} events from syncer", events.len());
        for (i, event) in events.iter().enumerate() {
            if i % 10000 == 0 {
                info!("Processing event {}/{}", i, events.len());
            }
            self.handle_event(&event)?;
        }

        // Rebuild
        info!("Rebuilding UTXO trees");
        for tree in self.utxo_trees.values_mut() {
            tree.rebuild();
        }

        // Verify
        info!("Verifying UTXO trees");
        self.verify().await?;

        info!("Synced to block {}", to_block);
        self.synced_block = to_block;
        for account in self.accounts.iter_mut() {
            account.set_synced_block(to_block);
        }

        // Save
        self.save().await?;

        Ok(())
    }

    fn handle_event(&mut self, event: &SyncEvent) -> Result<(), UtxoIndexerError> {
        match event {
            SyncEvent::Shield(shield, _) => self.handle_shield(shield)?,
            SyncEvent::Transact(transact, _) => self.handle_transact(transact)?,
            SyncEvent::Nullified(nullified, ts) => self.handle_nullified(nullified, *ts),
            SyncEvent::Legacy(legacy, _) => self.handle_legacy(legacy),
        };

        Ok(())
    }

    fn handle_shield(&mut self, event: &syncer::Shield) -> Result<(), UtxoIndexerError> {
        let leaf: UtxoLeafHash =
            poseidon_hash(&[event.npk, event.token.hash(), U256::from(event.value)])
                .unwrap()
                .into();
        self.insert_utxo_leaf(event.tree_number, event.leaf_index, leaf);

        for account in self.accounts.iter_mut() {
            account.handle_shield_event(event)?;
        }

        Ok(())
    }

    fn handle_transact(&mut self, event: &syncer::Transact) -> Result<(), UtxoIndexerError> {
        self.insert_utxo_leaf(event.tree_number, event.leaf_index, event.hash.into());

        for account in self.accounts.iter_mut() {
            account.handle_transact_event(event)?;
        }

        Ok(())
    }

    fn handle_nullified(&mut self, event: &syncer::Nullified, timestamp: u64) {
        for account in self.accounts.iter_mut() {
            account.handle_nullified_event(event, timestamp);
        }
    }

    fn handle_legacy(&mut self, event: &syncer::LegacyCommitment) {
        self.insert_utxo_leaf(event.tree_number, event.leaf_index, event.hash.into());
    }

    async fn verify(&self) -> Result<(), UtxoIndexerError> {
        for tree in self.utxo_trees.values() {
            if tree.leaves_len() == 0 {
                continue;
            }

            self.utxo_verifier
                .verify_root(tree.number(), tree.leaves_len() as u32 - 1, tree.root())
                .await
                .map_err(|e| UtxoIndexerError::VerificationError(e))?;
        }
        Ok(())
    }

    /// Insert a leaf into the appropriate UTXO tree, creating the tree if necessary
    fn insert_utxo_leaf(&mut self, tree_number: u32, leaf_index: u32, leaf: UtxoLeafHash) {
        let tree = self
            .utxo_trees
            .entry(tree_number)
            .or_insert(UtxoMerkleTree::new(tree_number));

        tree.insert_leaves_raw(&[leaf], leaf_index as usize);
    }

    /// Saves the current state of the indexer to the database.
    async fn save(&self) -> Result<(), DatabaseError> {
        let state = UtxoIndexerState {
            synced_block: self.synced_block,
            trees: self.utxo_trees.keys().cloned().collect(),
        };
        self.db.set_utxo_indexer(&state).await?;

        for (tree_number, tree) in self.utxo_trees.iter() {
            self.db.set_utxo_tree(*tree_number, tree.state()).await?;
        }

        for account in self.accounts.iter() {
            self.db
                .set_account(&account.address(), &account.state())
                .await?;
        }

        Ok(())
    }
}

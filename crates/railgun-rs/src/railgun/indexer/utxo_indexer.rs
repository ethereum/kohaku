use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
    u64,
};

use crypto::poseidon_hash;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::info;

use crate::railgun::{
    address::RailgunAddress,
    indexer::{
        indexed_account::{IndexedAccount, IndexedAccountState},
        syncer::{self, NoteSyncer, SyncEvent, SyncerError},
    },
    merkle_tree::{MerkleTreeState, MerkleTreeVerifier, UtxoLeafHash, UtxoMerkleTree},
    note::utxo::{NoteError, UtxoNote},
    signer::RailgunSigner,
};

/// Utxo indexer that maintains the set of UTXO merkle trees and tracks accounts
/// and account notes / balances.
pub struct UtxoIndexer {
    pub utxo_trees: BTreeMap<u32, UtxoMerkleTree>,
    pub synced_block: u64,

    utxo_syncer: Arc<dyn NoteSyncer>,
    utxo_verifier: Arc<dyn MerkleTreeVerifier>,

    // Accounts being actively tracked by the indexer.
    accounts: Vec<IndexedAccount>,

    // Accounts that have been tracked by the indexer, but have not been registered
    // since the last restart. If a signer is later registered we can restore its
    // state and continue tracking without re-syncing.
    pending_accounts: HashMap<RailgunAddress, IndexedAccountState>,
}

/// State struct for the Utxo indexer.
///
/// This state does NOT include the signer for any accounts. After restoring
/// from state, to continue tracking accounts, you must re-register each account's
/// signer.
#[derive(Serialize, Deserialize)]
pub struct UtxoIndexerState {
    pub utxo_trees: BTreeMap<u32, MerkleTreeState>,
    pub synced_block: u64,
    pub accounts: HashMap<RailgunAddress, IndexedAccountState>,
}

#[derive(Debug, Error)]
pub enum UtxoIndexerError {
    #[error("Syncer error: {0}")]
    SyncerError(#[from] SyncerError),
    #[error("Verification error: {0}")]
    VerificationError(#[source] Box<dyn std::error::Error + 'static>),
    #[error("Note error: {0}")]
    NoteError(#[from] NoteError),
    #[error("Timed out waiting for commitments")]
    Timeout,
}

impl UtxoIndexer {
    pub fn new(
        utxo_syncer: Arc<dyn NoteSyncer>,
        utxo_verifier: Arc<dyn MerkleTreeVerifier>,
    ) -> Self {
        UtxoIndexer {
            utxo_trees: BTreeMap::new(),
            synced_block: 0,
            utxo_syncer,
            utxo_verifier,
            accounts: vec![],
            pending_accounts: HashMap::new(),
        }
    }

    /// Restores the indexer state from a saved state. This will restore the synced
    /// UTXO trees and notes. To continue tracking accounts, you must also re-register
    /// each account's signer.
    pub fn set_state(&mut self, state: UtxoIndexerState) {
        let mut utxo_trees = BTreeMap::new();
        for (number, tree_state) in state.utxo_trees {
            utxo_trees.insert(number, UtxoMerkleTree::from_state(tree_state));
        }

        self.utxo_trees = utxo_trees;
        self.synced_block = state.synced_block;
        self.pending_accounts = state.accounts;
    }

    /// Returns the current state of the indexer, which can be saved and later
    /// used to restore the indexer state.
    ///
    /// While state does include the synced notes (sensitive data), it does NOT
    /// include the signer. After restoring from state, you must also re-register
    /// each signer to continue tracking their notes.
    pub fn state(&self) -> UtxoIndexerState {
        let utxo_trees = self
            .utxo_trees
            .iter()
            .map(|(k, v)| (*k, v.state()))
            .collect();
        let mut accounts: HashMap<RailgunAddress, IndexedAccountState> = self
            .accounts
            .iter()
            .map(|a| (a.address(), a.state()))
            .collect();

        accounts.extend(self.pending_accounts.clone());

        UtxoIndexerState {
            utxo_trees,
            synced_block: self.synced_block,
            accounts,
        }
    }

    pub fn synced_block(&self) -> u64 {
        let mut min_synced = self.synced_block;
        for account in self.accounts.iter() {
            min_synced = min_synced.min(account.synced_block);
        }
        min_synced
    }

    /// Register an account with the indexer. The indexer will track the account's
    /// notes and balance as it syncs.
    ///
    /// Registering an account does NOT trigger a re-sync. After registering, call
    /// `sync()` to sync the account's notes and balance.
    pub fn register(&mut self, signer: Arc<dyn RailgunSigner>) {
        self.register_from(signer, self.synced_block);
    }

    /// Registers an account starting from a specific block.
    pub fn register_from(&mut self, signer: Arc<dyn RailgunSigner>, from_block: u64) {
        let address = signer.address();
        if let Some(state) = self.pending_accounts.remove(&address) {
            let account = IndexedAccount::from_state(state, signer.clone());
            self.accounts.push(account);
            return;
        }

        let account = IndexedAccount::new(signer.clone(), from_block);
        self.accounts.push(account);
    }

    pub fn registered(&self) -> Vec<RailgunAddress> {
        self.accounts.iter().map(|a| a.address()).collect()
    }

    pub fn deregister_pending(&mut self) {
        self.pending_accounts.clear();
    }

    /// Returns a list of unspent notes for a given address
    pub fn unspent(&self, address: RailgunAddress) -> Vec<UtxoNote> {
        for account in self.accounts.iter() {
            if account.address() == address {
                return account.unspent();
            }
        }

        vec![]
    }

    /// Returns a list of all unspent notes across all accounts
    pub fn all_unspent(&self) -> Vec<UtxoNote> {
        let mut notes = Vec::new();
        for account in self.accounts.iter() {
            notes.extend(account.unspent());
        }

        notes
    }

    pub async fn sync(&mut self) -> Result<(), UtxoIndexerError> {
        self.sync_to(u64::MAX).await
    }

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
        for event in events {
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

        self.synced_block = to_block;
        for account in self.accounts.iter_mut() {
            account.synced_block = to_block;
        }
        Ok(())
    }

    /// Resets the indexer state
    pub fn reset(&mut self) {
        self.utxo_trees.clear();
        self.synced_block = 0;
        self.accounts.clear();
        self.pending_accounts.clear();
    }

    /// Handles a sync event.
    fn handle_event(&mut self, event: &SyncEvent) -> Result<(), UtxoIndexerError> {
        match event {
            SyncEvent::Shield(shield, _) => self.handle_shield(shield)?,
            SyncEvent::Transact(transact, _) => self.handle_transact(transact)?,
            SyncEvent::Nullified(nullified, ts) => self.handle_nullified(nullified, *ts),
            SyncEvent::Legacy(legacy, _) => self.handle_legacy(legacy),
        };

        Ok(())
    }

    /// Handles a shield event. Returns true if the event was matched to any account.
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

    /// Handles a transact event. Returns true if the event was matched to any account.
    fn handle_transact(&mut self, event: &syncer::Transact) -> Result<(), UtxoIndexerError> {
        self.insert_utxo_leaf(event.tree_number, event.leaf_index, event.hash.into());

        for account in self.accounts.iter_mut() {
            account.handle_transact_event(event)?;
        }

        Ok(())
    }

    /// Handles a nullified event. Returns true if the event was matched to any account.
    fn handle_nullified(&mut self, event: &syncer::Nullified, timestamp: u64) {
        for account in self.accounts.iter_mut() {
            account.handle_nullified_event(event, timestamp);
        }
    }

    /// Handles a legacy commitment event. Returns true if the event was matched to any account.
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
}

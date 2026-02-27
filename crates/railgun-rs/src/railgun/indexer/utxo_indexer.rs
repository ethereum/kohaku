use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::Arc,
    u64,
};

use crypto::poseidon_hash;
use futures::StreamExt;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    abis::railgun::RailgunSmartWallet,
    caip::AssetId,
    railgun::{
        address::RailgunAddress,
        indexer::{
            indexed_account::IndexedAccount,
            syncer::{LegacyCommitment, NoteSyncer, SyncEvent},
        },
        merkle_tree::{
            MerkleTreeState, MerkleTreeVerifier, TOTAL_LEAVES, UtxoLeafHash, UtxoMerkleTree,
            VerificationError,
        },
        note::utxo::{NoteError, UtxoNote},
        signer::Signer,
    },
};

/// Utxo indexer that maintains the set of UTXO merkle trees and tracks accounts
/// and account notes / balances.
///
/// While accounts are not persisted, matched events are. This allows the indexer
/// to rebuild account state for previously synced accounts when they are re-added
/// after a restart.
pub struct UtxoIndexer {
    pub utxo_trees: BTreeMap<u32, UtxoMerkleTree>,
    pub synced_block: u64,

    utxo_syncer: Arc<dyn NoteSyncer>,
    utxo_verifier: Arc<dyn MerkleTreeVerifier>,

    accounts: Vec<IndexedAccount>,
    matched_events: Vec<SyncEvent>,
    seen_commitments: HashSet<U256>,
}

#[derive(Serialize, Deserialize)]
pub struct UtxoIndexerState {
    pub utxo_trees: BTreeMap<u32, MerkleTreeState>,
    pub synced_block: u64,
    pub matched_events: Vec<SyncEvent>,
}

#[derive(Debug, Error)]
pub enum UtxoIndexerError {
    #[error("Syncer error: {0}")]
    SyncerError(Box<dyn std::error::Error>),
    #[error("Verification error: {0}")]
    VerificationError(#[from] VerificationError),
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
            matched_events: vec![],
            seen_commitments: HashSet::new(),
        }
    }

    pub fn set_state(&mut self, state: UtxoIndexerState) {
        let mut utxo_trees = BTreeMap::new();
        for (number, tree_state) in state.utxo_trees {
            utxo_trees.insert(
                number,
                UtxoMerkleTree::from_state(tree_state).with_verifier(self.utxo_verifier.clone()),
            );
        }

        self.utxo_trees = utxo_trees;
        self.synced_block = state.synced_block;
        self.matched_events = state.matched_events;
    }

    pub fn state(&self) -> UtxoIndexerState {
        let utxo_trees = self
            .utxo_trees
            .iter()
            .map(|(k, v)| (*k, v.state()))
            .collect();

        UtxoIndexerState {
            utxo_trees,
            synced_block: self.synced_block,
            matched_events: self.matched_events.clone(),
        }
    }

    pub fn synced_block(&self) -> u64 {
        self.synced_block
    }

    /// Adds an account to the indexer. The indexer will track the balance and
    /// transactions for this account as it syncs.
    pub fn register(&mut self, signer: Arc<dyn Signer>) {
        let account = IndexedAccount::new(signer.clone());
        self.accounts.push(account);

        //? Replay matched events to populate account state
        for event in self.matched_events.clone() {
            if let Err(e) = self.handle_event(&event) {
                tracing::error!("Error handling event for new account: {}", e);
            }
        }
    }

    /// Adds an account to the indexer and immediately resync to populate its state.
    ///
    /// Resyncing is necessary to initially populate an account's state. Resyncing
    /// can be skipped if an account is being added after a restart, since matched
    /// events are persisted and will be replayed to populate the account's state.
    pub async fn register_resync(
        &mut self,
        _signer: Arc<dyn Signer>,
        _from_block: u64,
    ) -> Result<(), UtxoIndexerError> {
        todo!()
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

    /// Returns the balance of a given address by summing the values of all
    /// unspent notes for that address.
    pub fn balance(&self, address: RailgunAddress) -> HashMap<AssetId, u128> {
        for account in self.accounts.iter() {
            if account.address() == address {
                return account.balance();
            }
        }

        HashMap::new()
    }

    pub async fn sync(&mut self) -> Result<(), UtxoIndexerError> {
        self.sync_to(u64::MAX).await
    }

    #[tracing::instrument(name = "utxo_sync", skip_all)]
    pub async fn sync_to(&mut self, to_block: u64) -> Result<(), UtxoIndexerError> {
        let from_block = self.synced_block + 1;

        let syncer = self.utxo_syncer.clone();
        let latest_block = syncer
            .latest_block()
            .await
            .map_err(UtxoIndexerError::SyncerError)?;
        let to_block = to_block.min(latest_block);

        if from_block > to_block {
            return Ok(());
        }

        // Sync
        let mut stream = syncer
            .sync(from_block, to_block)
            .await
            .map_err(UtxoIndexerError::SyncerError)?;

        while let Some(event) = stream.next().await {
            let matched = self.handle_event(&event)?;
            if matched {
                self.matched_events.push(event);
            }
        }

        // Rebuild
        for tree in self.utxo_trees.values_mut() {
            tree.rebuild();
        }

        // Verify
        self.verify().await?;

        self.synced_block = to_block;
        Ok(())
    }

    /// Resets the indexer state
    pub fn reset(&mut self) {
        self.utxo_trees.clear();
        self.synced_block = 0;
        self.accounts.clear();
        self.matched_events.clear();
        self.seen_commitments.clear();
    }

    /// Returns true if all the given commitments have been seen in Transact events.
    pub fn has_commitments(&self, commitments: &[U256]) -> bool {
        commitments
            .iter()
            .all(|c| self.seen_commitments.contains(c))
    }

    /// Polls `sync()` until all given commitments appear in Transact events,
    /// or returns `Err(Timeout)` if the timeout is exceeded.
    pub async fn await_commitments(
        &mut self,
        commitments: &[U256],
        poll_interval: web_time::Duration,
        timeout: web_time::Duration,
    ) -> Result<(), UtxoIndexerError> {
        let start = web_time::Instant::now();

        loop {
            self.sync().await?;

            if self.has_commitments(commitments) {
                return Ok(());
            }

            if start.elapsed() >= timeout {
                return Err(UtxoIndexerError::Timeout);
            }

            crate::sleep::sleep(poll_interval).await;
        }
    }

    /// Handles a sync event. Returns true if the event was matched to any account.
    fn handle_event(&mut self, event: &SyncEvent) -> Result<bool, UtxoIndexerError> {
        let matched = match event {
            SyncEvent::Shield(shield, _) => self.handle_shield(shield)?,
            SyncEvent::Transact(transact, _) => self.handle_transact(transact)?,
            SyncEvent::Nullified(nullified, ts) => self.handle_nullified(nullified, *ts),
            SyncEvent::Legacy(legacy, _) => self.handle_legacy(legacy),
        };

        Ok(matched)
    }

    /// Handles a shield event. Returns true if the event was matched to any account.
    fn handle_shield(
        &mut self,
        event: &RailgunSmartWallet::Shield,
    ) -> Result<bool, UtxoIndexerError> {
        let leaves: Vec<UtxoLeafHash> = event
            .commitments
            .iter()
            .map(|c| {
                let npk = U256::from_be_bytes(*c.npk);
                let token_id: AssetId = c.token.clone().into();
                let token_id = token_id.hash();
                let value = U256::from(c.value);

                poseidon_hash(&[npk, token_id, value]).unwrap().into()
            })
            .collect();

        insert_utxo_leaves(
            &mut self.utxo_trees,
            event.treeNumber.saturating_to(),
            event.startPosition.saturating_to(),
            &leaves,
            self.utxo_verifier.clone(),
        );

        let mut matched = false;
        for account in self.accounts.iter_mut() {
            matched |= account.handle_shield_event(event)?;
        }

        Ok(matched)
    }

    /// Handles a transact event. Returns true if the event was matched to any account.
    fn handle_transact(
        &mut self,
        event: &RailgunSmartWallet::Transact,
    ) -> Result<bool, UtxoIndexerError> {
        let leaves: Vec<UtxoLeafHash> = event
            .hash
            .iter()
            .map(|h| U256::from_be_bytes(**h).into())
            .collect();

        // Track commitment hashes for await_commitments
        for h in &event.hash {
            self.seen_commitments.insert(U256::from_be_bytes(**h));
        }

        insert_utxo_leaves(
            &mut self.utxo_trees,
            event.treeNumber.saturating_to(),
            event.startPosition.saturating_to(),
            &leaves,
            self.utxo_verifier.clone(),
        );

        let mut matched = false;
        for account in self.accounts.iter_mut() {
            matched |= account.handle_transact_event(event)?;
        }

        Ok(matched)
    }

    /// Handles a nullified event. Returns true if the event was matched to any account.
    fn handle_nullified(&mut self, event: &RailgunSmartWallet::Nullified, timestamp: u64) -> bool {
        let mut matched = false;
        for account in self.accounts.iter_mut() {
            matched |= account.handle_nullified_event(event, timestamp);
        }
        matched
    }

    /// Handles a legacy commitment event. Returns true if the event was matched to any account.
    fn handle_legacy(&mut self, event: &LegacyCommitment) -> bool {
        insert_utxo_leaves(
            &mut self.utxo_trees,
            event.tree_number,
            event.leaf_index as usize,
            &[event.hash.into()],
            self.utxo_verifier.clone(),
        );

        // TODO: Handle legacy events for accounts.
        false
    }

    async fn verify(&self) -> Result<(), VerificationError> {
        for tree in self.utxo_trees.values() {
            tree.verify().await?;
        }
        Ok(())
    }
}

/// Inserts UTXO leaves into the appropriate tree, handling tree boundaries.
///
/// If the leaves cross a tree boundary, it will fill the first tree, then
/// insert the remaining leaves into the next tree.
fn insert_utxo_leaves(
    trees: &mut BTreeMap<u32, UtxoMerkleTree>,
    tree_number: u32,
    start_position: usize,
    leaves: &[UtxoLeafHash],
    verifier: Arc<dyn MerkleTreeVerifier>,
) {
    let mut remaining = leaves;
    let mut current_tree = tree_number + (start_position / TOTAL_LEAVES) as u32;
    let mut position = start_position % TOTAL_LEAVES;

    while !remaining.is_empty() {
        let space_in_tree = TOTAL_LEAVES - position;
        let to_insert = remaining.len().min(space_in_tree);

        trees
            .entry(current_tree)
            .or_insert_with(|| UtxoMerkleTree::new(current_tree).with_verifier(verifier.clone()))
            .insert_leaves_raw(&remaining[..to_insert], position);

        remaining = &remaining[to_insert..];
        current_tree += 1;
        position = 0;
    }
}

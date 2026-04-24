//! Because Railgun's transaction-within-transaction language is confusing, I'm
//! setting some ground rules.
//!
//! A "Note" is an already-on-chain note, which can be used as an input to an Operation.
//!
//! A "Operation" means a single railgun transaction (IE `RailgunSmartWallet.Transaction` object).
//!  - An operation can have many input notes, but they must all be on the same tree and held by the
//!    same address.
//!  - An operation may have many output notes, which can be to different addresses and on different
//!    trees.
//!  - An operation may only have one unshield note, since the `RailgunSmartWallet.Transaction`
//!    struct only
//!
//! A "Transaction" means an EVM transaction.
//!  - A transaction can have many operations across many trees and addresses.

use std::{
    collections::{BTreeMap, HashSet},
    sync::Arc,
};

use alloy_primitives::{Address, U256};
use prover::{Prover, ProverError};
use rand::Rng;
use thiserror::Error;
use tracing::info;

use crate::{
    abis,
    caip::AssetId,
    circuit::{
        inputs::{TransactCircuitInputs, TransactCircuitInputsError},
        prover::prove_transact,
    },
    railgun::{
        address::RailgunAddress,
        merkle_tree::UtxoMerkleTree,
        note::{
            IncludedNote,
            encrypt::EncryptError,
            operation::{Operation, OperationVerificationError},
            transfer::TransferNote,
            unshield::UnshieldNote,
        },
        signer::Signer,
        transaction::{ProvedOperation, ProvedTx},
    },
};

/// Basic builder for constructing railgun transactions. Transactions are sets
/// of shielded operations (transfers and unshield) that are proved together
/// and can be executed in a single on-chain transaction.
#[derive(Clone)]
pub struct TransactionBuilder {
    intents: Vec<Intent>,
    unshields: HashSet<(RailgunAddress, AssetId)>,
}

#[derive(Clone)]
struct Intent {
    pub from: Arc<dyn Signer>,
    pub asset: AssetId,
    pub value: u128,
    pub kind: IntentKind,
}

#[derive(Clone)]
enum IntentKind {
    Transfer { to: RailgunAddress, memo: String },
    Unshield { to: Address },
}

#[derive(Debug, Error)]
pub enum TransactionBuilderError {
    #[error(
        "Multiple unshield operations from the same address and asset are not supported: from {from}, asset {asset}"
    )]
    MultipleUnshields {
        from: RailgunAddress,
        asset: AssetId,
    },
    #[error("Insufficient balance for intent with from {from}, asset {asset}, value {value}")]
    InsufficientBalance {
        from: RailgunAddress,
        asset: AssetId,
        value: u128,
    },
    #[error("Encryption error: {0}")]
    Encryption(#[from] EncryptError),
    #[error("Prover error: {0}")]
    Prover(#[from] ProverError),
    #[error("Missing tree for number {0}")]
    MissingTree(u32),
    #[error("No input notes")]
    NoInputNotes,
    #[error("Transact circuit input error: {0}")]
    TransactCircuitInput(#[from] TransactCircuitInputsError),
    #[error("Operation verification error: {0}")]
    OperationVerification(#[from] OperationVerificationError),
}

impl TransactionBuilder {
    pub fn new() -> Self {
        Self {
            intents: Vec::new(),
            unshields: HashSet::new(),
        }
    }
}

impl TransactionBuilder {
    /// Adds a transfer operation to this transaction.
    pub fn transfer(
        mut self,
        from: Arc<dyn Signer>,
        to: RailgunAddress,
        asset: AssetId,
        value: u128,
        memo: &str,
    ) -> Self {
        self.intents.push(Intent {
            from,
            asset,
            value,
            kind: IntentKind::Transfer {
                to,
                memo: memo.to_string(),
            },
        });
        self
    }

    /// Adds an unshield operation to this transaction.
    pub fn unshield(
        mut self,
        from: Arc<dyn Signer>,
        to: Address,
        asset: AssetId,
        value: u128,
    ) -> Result<Self, TransactionBuilderError> {
        if self.unshields.contains(&(from.address(), asset)) {
            return Err(TransactionBuilderError::MultipleUnshields {
                from: from.address(),
                asset,
            });
        }
        self.unshields.insert((from.address(), asset));

        self.intents.push(Intent {
            from,
            asset,
            value,
            kind: IntentKind::Unshield { to },
        });
        Ok(self)
    }

    /// Builds and proves a transaction for railgun.
    pub async fn build_transaction<N: IncludedNote, R: Rng>(
        &self,
        prover: &dyn Prover,
        chain_id: u64,
        railgun_smart_wallet: Address,
        in_notes: &[N],
        utxo_trees: &BTreeMap<u32, UtxoMerkleTree>,
        rng: &mut R,
    ) -> Result<ProvedTx<N>, TransactionBuilderError> {
        let operations = self
            .build(prover, chain_id, in_notes, utxo_trees, rng)
            .await?;
        Ok(ProvedTx::new(railgun_smart_wallet, operations))
    }

    /// Builds and proves a set of operations for railgun, without packaging into a transaction.
    pub async fn build<N: IncludedNote, R: Rng>(
        &self,
        prover: &dyn Prover,
        chain_id: u64,
        in_notes: &[N],
        utxo_trees: &BTreeMap<u32, UtxoMerkleTree>,
        rng: &mut R,
    ) -> Result<Vec<ProvedOperation<N>>, TransactionBuilderError> {
        let groups = self.group_intents();
        let operations = build_groups(in_notes, groups, rng)?;

        for op in &operations {
            op.verify()?;
        }

        let proved = prove_operations(prover, utxo_trees, chain_id, &operations, rng).await?;
        Ok(proved)
    }

    /// Group intents with the following rules:
    ///
    /// 1. Each group has a single asset.
    /// 2. Each group has a single signer.
    /// 3. Each group has at most one unshield.
    fn group_intents(&self) -> BTreeMap<(RailgunAddress, AssetId), Vec<Intent>> {
        let mut groups = BTreeMap::new();
        for intent in &self.intents {
            groups
                .entry((intent.from.address(), intent.asset))
                .or_insert_with(Vec::new)
                .push(intent.clone());
        }

        groups
    }
}

/// Build the operations for each group of intents.
fn build_groups<N: IncludedNote, R: Rng>(
    in_notes: &[N],
    groups: BTreeMap<(RailgunAddress, AssetId), Vec<Intent>>,
    rng: &mut R,
) -> Result<Vec<Operation<N>>, TransactionBuilderError> {
    let mut operations = Vec::new();
    for ((from, asset), intents) in groups {
        let ops = build_group(in_notes, from, asset, intents, rng)?;
        operations.extend(ops);
    }
    Ok(operations)
}

/// Build the operations for a single group of intents.
fn build_group<N: IncludedNote, R: Rng>(
    in_notes: &[N],
    from: RailgunAddress,
    asset: AssetId,
    mut intents: Vec<Intent>,
    rng: &mut R,
) -> Result<Vec<Operation<N>>, TransactionBuilderError> {
    // Sort intents smallest to largest. Helps to ensure small intents don't
    // ever need to span across multiple trees.
    intents.sort_by(|a, b| a.value.cmp(&b.value));

    // Filter notes for this asset and signer, and group by tree number.
    let tree_number: BTreeMap<u32, Vec<&N>> = in_notes
        .iter()
        .filter(|n| n.asset() == asset && n.viewing_pubkey() == from.viewing_pubkey())
        .fold(BTreeMap::new(), |mut acc, n| {
            acc.entry(n.tree_number()).or_insert_with(Vec::new).push(n);
            acc
        });

    let mut balances: BTreeMap<u32, u128> = tree_number
        .iter()
        .map(|(tree_number, notes)| {
            let balance = notes.iter().map(|n| n.value()).sum();
            (*tree_number, balance)
        })
        .collect();

    // Fit intents to trees.
    let mut operations: BTreeMap<u32, Operation<N>> = BTreeMap::new();
    for intent in intents {
        //? Try single tree first (oldest sufficient).
        let single = balances
            .iter()
            .find(|&(_, bal)| bal >= &intent.value)
            .map(|(&t, _)| t);

        if let Some(tree) = single {
            *balances.get_mut(&tree).unwrap() -= intent.value;
            insert_operation(&mut operations, tree, intent, rng);
            continue;
        }

        split_intent(from, asset, intent, &mut balances, &mut operations, rng)?;
    }

    // Add in notes to operations
    for (tree, op) in operations.iter_mut() {
        let Some(notes) = tree_number.get(tree) else {
            debug_assert!(false, "Tree {} should exist in tree_number", tree);
            continue;
        };

        let selected = select_notes(notes, op.out_value());
        for note in selected {
            op.add_in_note(note.clone());
        }
        add_change_note(op, asset, rng);
    }

    Ok(operations.into_values().collect())
}

/// Helper for fitting an intent to multiple trees when it can't fit on a single tree.
fn split_intent<N: IncludedNote, R: Rng>(
    from: RailgunAddress,
    asset: AssetId,
    intent: Intent,
    balances: &mut BTreeMap<u32, u128>,
    operations: &mut BTreeMap<u32, Operation<N>>,
    rng: &mut R,
) -> Result<(), TransactionBuilderError> {
    let mut remaining = intent.value;
    let trees: Vec<u32> = balances.keys().copied().collect();
    for tree in trees {
        if remaining == 0 {
            break;
        }

        let available = *balances.get(&tree).unwrap();
        if available == 0 {
            continue;
        }

        let take = remaining.min(available);
        *balances.get_mut(&tree).unwrap() -= take;

        let mut partial = intent.clone();
        partial.value = take;
        insert_operation(operations, tree, partial, rng);

        remaining -= take;
    }

    if remaining > 0 {
        return Err(TransactionBuilderError::InsufficientBalance {
            from,
            asset,
            value: intent.value,
        });
    }
    Ok(())
}

/// Helper to insert an intent into an operation, creating the operation if it
/// doesn't exist.
fn insert_operation<N: IncludedNote, R: Rng>(
    operations: &mut BTreeMap<u32, Operation<N>>,
    tree: u32,
    intent: Intent,
    rng: &mut R,
) {
    let from = intent.from.clone();
    let asset = intent.asset;
    let op = operations
        .entry(tree)
        .or_insert(Operation::new_empty(tree, from, asset));

    match intent.kind {
        IntentKind::Transfer { to, memo } => op.add_out_note(TransferNote::new(
            intent.from.viewing_key(),
            to,
            intent.asset,
            intent.value,
            rng.random(),
            &memo,
        )),
        IntentKind::Unshield { to } => {
            op.set_unshield_note(UnshieldNote::new(to, intent.asset, intent.value))
        }
    }
}

/// TODO: Improve selection algorithm to minimize the number of notes used while
/// avoiding creating many dust notes
fn select_notes<'a, N: IncludedNote>(notes: &'a [&N], value: u128) -> Vec<&'a N> {
    let mut selected: Vec<&N> = Vec::new();
    let mut total = 0;
    for note in notes {
        selected.push(note);
        total += note.value();
        if total >= value {
            break;
        }
    }
    selected
}

/// Helper to add a change note to an operation if there is excess value.
fn add_change_note<N: IncludedNote, R: Rng>(
    operation: &mut Operation<N>,
    asset: AssetId,
    rng: &mut R,
) {
    let signer = operation.from.clone();
    let change = operation.in_value().saturating_sub(operation.out_value());
    if change > 0 {
        let change_note = TransferNote::new(
            signer.viewing_key(),
            signer.address(),
            asset,
            change,
            rng.random(),
            "change",
        );
        operation.add_out_note(change_note);
    }
}

async fn prove_operations<N: IncludedNote, R: Rng>(
    prover: &dyn Prover,
    utxo_trees: &BTreeMap<u32, UtxoMerkleTree>,
    chain_id: u64,
    operations: &[Operation<N>],
    rng: &mut R,
) -> Result<Vec<ProvedOperation<N>>, TransactionBuilderError> {
    let mut proved = Vec::new();
    for op in operations {
        let tree = op.utxo_tree_number;
        let Some(utxo_tree) = utxo_trees.get(&tree) else {
            return Err(TransactionBuilderError::MissingTree(tree));
        };
        let proved_op = prove_operation(prover, utxo_tree, chain_id, op, rng).await?;
        proved.push(proved_op);
    }
    Ok(proved)
}

async fn prove_operation<N: IncludedNote, R: Rng>(
    prover: &dyn Prover,
    utxo_tree: &UtxoMerkleTree,
    chain_id: u64,
    operation: &Operation<N>,
    rng: &mut R,
) -> Result<ProvedOperation<N>, TransactionBuilderError> {
    info!("Constructing circuit inputs");
    let unshield_note = operation.unshield_note();
    let unshield_type = unshield_note.map(|n| n.unshield_type()).unwrap_or_default();
    let unshield_preimage = unshield_note.map(|n| n.preimage()).unwrap_or_default();

    let commitment_ciphertexts: Vec<abis::railgun::CommitmentCiphertext> = operation
        .out_encryptable_notes()
        .iter()
        .map(|n| n.encrypt(rng))
        .collect::<Result<_, _>>()?;

    //? min_gas_price, adapt_contract, and adapt_input are all vestigial fields for
    //? railgun relayers.
    let bound_params = abis::railgun::BoundParams::new(
        utxo_tree.number() as u16,
        0,
        unshield_type,
        chain_id,
        Address::ZERO,
        &[0u8; 32],
        commitment_ciphertexts,
    );

    let inputs = TransactCircuitInputs::from_inputs(
        utxo_tree,
        bound_params.hash(),
        operation.from.clone(),
        operation.asset,
        operation.in_notes(),
        &operation.out_notes(),
    )?;
    let (proof, _) = prove_transact(prover, &inputs).await?;

    let merkleroot: U256 = inputs.merkleroot.into();
    let transaction = abis::railgun::Transaction::new(
        proof.into(),
        merkleroot.into(),
        inputs.nullifiers.iter().map(|n| n.clone().into()).collect(),
        inputs
            .commitments_out
            .iter()
            .map(|c| c.clone().into())
            .collect(),
        bound_params,
        unshield_preimage,
    );

    Ok(ProvedOperation::new(operation.clone(), inputs, transaction))
}

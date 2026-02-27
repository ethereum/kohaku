//! Because Railgun's transaction-within-transaction language is confusing, I'm
//! setting some ground rules.
//!
//! A "Note" is an already-on-chain note, which can be used as an input to an Operation.
//!
//! A "Operation" means a single railgun transaction (IE `RailgunSmartWallet.Transaction` object).
//!  - An operation can have many input notes, but they must all be on the same tree and held by the same address.
//!  - An operation may have many output notes, which can be to different addresses and on different trees.
//!  - An operation may only have one unshield note, since the `RailgunSmartWallet.Transaction` struct only
//!
//! A "Transaction" means an EVM transaction.
//!  - A transaction can have many operations across many trees and addresses.

use std::{
    collections::{BTreeMap, HashMap},
    sync::Arc,
};

use alloy::primitives::Address;
use rand::Rng;
use thiserror::Error;
use tracing::{info, warn};

use crate::{
    abis,
    caip::AssetId,
    chain_config::ChainConfig,
    circuit::{
        inputs::{TransactCircuitInputs, TransactCircuitInputsError},
        prover::TransactProver,
    },
    crypto::keys::ViewingPublicKey,
    railgun::{
        address::RailgunAddress,
        indexer::UtxoIndexer,
        merkle_tree::UtxoMerkleTree,
        note::{
            IncludedNote, Note, SignableNote,
            encrypt::EncryptError,
            operation::{Operation, OperationVerificationError},
            transfer::TransferNote,
            unshield::UnshieldNote,
        },
        signer::Signer,
        transaction::{ProvedOperation, ProvedTx, TxData},
    },
};

/// A builder for constructing railgun transactions (transfers, unshields)
#[derive(Clone)]
pub struct TransactionBuilder {
    pub(crate) transfers: Vec<TransferData>,
    pub(crate) unshields: BTreeMap<AssetId, UnshieldData>,
    pub(crate) signers: BTreeMap<ViewingPublicKey, Arc<dyn Signer>>,
}

#[derive(Clone)]
pub struct TransferData {
    pub from: Arc<dyn Signer>,
    pub to: RailgunAddress,
    pub asset: AssetId,
    pub value: u128,
    pub memo: String,
}

#[derive(Clone)]
pub struct UnshieldData {
    pub from: Arc<dyn Signer>,
    pub to: Address,
    pub asset: AssetId,
    pub value: u128,
}

#[derive(Debug, Error)]
pub enum TransactionBuilderError {
    #[error("Multiple unshield operations are not supported")]
    MultipleUnshields,
    #[error("Encryption error: {0}")]
    Encryption(#[from] EncryptError),
    #[error("Prover error: {0}")]
    Prover(Box<dyn std::error::Error>),
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
            transfers: Vec::new(),
            unshields: BTreeMap::new(),
            signers: BTreeMap::new(),
        }
    }
}

impl TransactionBuilder {
    pub fn transfer(
        mut self,
        from: Arc<dyn Signer>,
        to: RailgunAddress,
        asset: AssetId,
        value: u128,
        memo: &str,
    ) -> Self {
        self.signers
            .insert(from.viewing_key().public_key(), from.clone());

        let transfer_data = TransferData {
            from,
            to,
            asset,
            value,
            memo: memo.to_string(),
        };
        self.transfers.push(transfer_data);
        self
    }

    pub fn set_unshield(
        mut self,
        from: Arc<dyn Signer>,
        to: Address,
        asset: AssetId,
        value: u128,
    ) -> Self {
        self.signers
            .insert(from.viewing_key().public_key(), from.clone());

        let unshield_data = UnshieldData {
            from,
            to,
            asset,
            value,
        };
        let old = self.unshields.insert(asset, unshield_data);
        if old.is_some() {
            warn!(
                "Overwriting existing unshield data for {}",
                old.unwrap().asset
            );
        }
        self
    }

    /// Builds and proves a transaction for railgun.
    ///
    /// The resulting transaction can be self-broadcasted, but does not include
    /// any POI proofs.
    pub async fn build<R: Rng>(
        self,
        chain: ChainConfig,
        indexer: &UtxoIndexer,
        prover: &dyn TransactProver,
        rng: &mut R,
    ) -> Result<ProvedTx, TransactionBuilderError> {
        let in_notes = indexer.all_unspent();
        let draft = self.draft_operations(rng);
        let ops = build_operations(draft, in_notes, rng)?;
        let proved = prove_operations(prover, &indexer.utxo_trees, &ops, chain, 0, rng).await?;

        Ok(proved)
    }

    /// Drafts the operations by grouping output notes by (from_address, asset_id)
    pub(crate) fn draft_operations<N: Note, R: Rng>(
        &self,
        rng: &mut R,
    ) -> HashMap<(RailgunAddress, AssetId), Operation<N>> {
        let mut draft_operations: HashMap<(RailgunAddress, AssetId), Operation<N>> = HashMap::new();
        for transfer in &self.transfers {
            draft_operations
                .entry((transfer.from.address(), transfer.asset))
                .or_insert(Operation::new_empty(
                    0,
                    transfer.from.clone(),
                    transfer.asset,
                ))
                .out_notes
                .push(TransferNote::new(
                    transfer.from.viewing_key(),
                    transfer.to,
                    transfer.asset,
                    transfer.value,
                    rng.random(),
                    &transfer.memo,
                ));
        }

        for unshield in self.unshields.values() {
            draft_operations
                .entry((unshield.from.address(), unshield.asset))
                .or_insert(Operation::new_empty(
                    0,
                    unshield.from.clone(),
                    unshield.asset,
                ))
                .unshield_note = Some(UnshieldNote::new(
                unshield.to,
                unshield.asset,
                unshield.value,
            ));
        }

        draft_operations
    }
}

/// Builds operations from a draft by populating input notes, splitting by tree number, and adding
/// change notes if necessary.
pub fn build_operations<N: IncludedNote + Clone, R: Rng>(
    mut draft: HashMap<(RailgunAddress, AssetId), Operation<N>>,
    in_notes: Vec<N>,
    rng: &mut R,
) -> Result<Vec<Operation<N>>, TransactionBuilderError> {
    //? Collect input notes to satisfy each operation's output value.
    draft.values_mut().for_each(|o| {
        o.in_notes = select_in_notes(o.from.address(), o.asset, o.out_value(), &in_notes)
    });

    //? Split operations by tree number
    let mut operations = Vec::new();
    for draft_op in draft.into_values() {
        let split_ops = split_trees(draft_op)?;
        operations.extend(split_ops);
    }

    //? Add change notes
    let operations: Vec<_> = operations
        .into_iter()
        .map(|o| add_change_note(o, rng))
        .collect();

    //? Verify operations
    for op in &operations {
        op.verify()?;
    }

    Ok(operations)
}

/// Proves the operations and returns a proved transaction that can be
/// executed in railgun on-chain.
pub async fn prove_operations<N: IncludedNote + SignableNote + Clone, R: Rng>(
    prover: &dyn TransactProver,
    utxo_trees: &BTreeMap<u32, UtxoMerkleTree>,
    operations: &[Operation<N>],
    chain: ChainConfig,
    min_gas_price: u128,
    rng: &mut R,
) -> Result<ProvedTx<N>, TransactionBuilderError> {
    let tx_results = create_transactions(
        prover,
        utxo_trees,
        operations,
        chain,
        min_gas_price,
        Address::ZERO,
        &[0u8; 32],
        rng,
    )
    .await?;

    let proved_operations: Vec<ProvedOperation<N>> = operations
        .iter()
        .zip(tx_results)
        .map(|(op, (ci, tx))| ProvedOperation {
            operation: op.clone(),
            circuit_inputs: ci,
            transaction: tx,
        })
        .collect();

    let transactions: Vec<_> = proved_operations
        .iter()
        .map(|po| po.transaction.clone())
        .collect();
    let tx_data = TxData::from_transactions(chain.railgun_smart_wallet, transactions);

    Ok(ProvedTx {
        proved_operations,
        tx_data,
        min_gas_price,
    })
}

/// Selects input notes for an operation.
fn select_in_notes<N: IncludedNote + Clone>(
    from: RailgunAddress,
    asset: AssetId,
    value: u128,
    in_notes: &[N],
) -> Vec<N> {
    //? Naive implementation: just takes notes until we have enough value.
    let mut selected = Vec::new();
    let mut total = 0;
    for note in in_notes {
        if note.viewing_pubkey() == from.viewing_pubkey() && note.asset() == asset {
            selected.push(note.clone());
            total += note.value();
            if total >= value {
                break;
            }
        }
    }

    selected
}

/// Splits an operation into multiple operations by tree number if the input notes
/// are from different trees. The outputs are also split accordingly.
fn split_trees<N: IncludedNote>(
    operation: Operation<N>,
) -> Result<Vec<Operation<N>>, TransactionBuilderError> {
    //? Naive impl: Assumes that all in notes are from the same tree, so no need to
    //? split.
    let tree_number = operation
        .in_notes
        .first()
        .map(|n| n.tree_number())
        .ok_or(TransactionBuilderError::NoInputNotes)?;

    for note in operation.in_notes.iter() {
        if note.tree_number() != tree_number {
            todo!("Implement operation splitting for notes from different trees");
        }
    }

    Ok(vec![Operation {
        utxo_tree_number: tree_number,
        ..operation
    }])
}

/// Adds a change note to the operation if required. The change note sends any
/// excess consumed value back to the sender's address.
fn add_change_note<R: Rng, N: IncludedNote + Clone>(
    operation: Operation<N>,
    rng: &mut R,
) -> Operation<N> {
    let in_value = operation.in_value();
    let out_value = operation.out_value();
    let change_value = in_value.saturating_sub(out_value);

    if change_value > 0 {
        let change_note = TransferNote::new(
            operation.from.viewing_key(),
            operation.from.address(),
            operation.asset,
            change_value,
            rng.random(),
            "change",
        );
        let mut new_operation = operation.clone();
        new_operation.out_notes.push(change_note);
        new_operation
    } else {
        operation
    }
}

/// Creates a list of railgun transactions for a list of operations.
pub async fn create_transactions<N: IncludedNote + SignableNote, R: Rng>(
    prover: &dyn TransactProver,
    utxo_trees: &BTreeMap<u32, UtxoMerkleTree>,
    operations: &[Operation<N>],
    chain: ChainConfig,
    min_gas_price: u128,
    adapt_contract: Address,
    adapt_input: &[u8; 32],
    rng: &mut R,
) -> Result<Vec<(TransactCircuitInputs, abis::railgun::Transaction)>, TransactionBuilderError> {
    let mut transactions = Vec::new();
    for operation in operations {
        operation.verify()?;

        let tree_number = operation.utxo_tree_number();
        let tree = utxo_trees
            .get(&tree_number)
            .ok_or(TransactionBuilderError::MissingTree(tree_number))?;

        let tx = create_transaction(
            prover,
            tree,
            operation,
            chain,
            min_gas_price,
            adapt_contract,
            adapt_input,
            rng,
        )
        .await?;

        transactions.push(tx);
    }

    Ok(transactions)
}

/// Creates a railgun transaction for a single operation.
async fn create_transaction<N: IncludedNote + SignableNote, R: Rng>(
    prover: &dyn TransactProver,
    utxo_tree: &UtxoMerkleTree,
    operation: &Operation<N>,
    chain: ChainConfig,
    min_gas_price: u128,
    adapt_contract: Address,
    adapt_input: &[u8; 32],
    rng: &mut R,
) -> Result<(TransactCircuitInputs, abis::railgun::Transaction), TransactionBuilderError> {
    let notes_in = operation.in_notes();
    let notes_out = operation.out_notes();

    info!("Constructing circuit inputs");
    let unshield_type = operation
        .unshield_note()
        .map(|n| n.unshield_type())
        .unwrap_or_default();

    let commitment_ciphertexts: Vec<abis::railgun::CommitmentCiphertext> = operation
        .out_encryptable_notes()
        .iter()
        .map(|n| n.encrypt(rng))
        .collect::<Result<_, _>>()?;

    let bound_params = abis::railgun::BoundParams::new(
        utxo_tree.number() as u16,
        min_gas_price,
        unshield_type,
        chain.id,
        adapt_contract,
        adapt_input,
        commitment_ciphertexts,
    );

    let inputs =
        TransactCircuitInputs::from_inputs(utxo_tree, bound_params.hash(), notes_in, &notes_out)?;

    info!("Proving transaction");
    let (proof, _) = prover
        .prove_transact(&inputs)
        .await
        .map_err(TransactionBuilderError::Prover)?;

    let transaction = abis::railgun::Transaction {
        proof: proof.into(),
        merkleRoot: inputs.merkleroot.into(),
        nullifiers: inputs.nullifiers.iter().map(|n| n.clone().into()).collect(),
        commitments: inputs
            .commitments_out
            .iter()
            .map(|c| c.clone().into())
            .collect(),
        boundParams: bound_params,
        unshieldPreimage: operation
            .unshield_note()
            .map(|n| n.preimage())
            .unwrap_or_default(),
    };

    Ok((inputs, transaction))
}

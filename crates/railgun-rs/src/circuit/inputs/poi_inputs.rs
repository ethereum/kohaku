use prover::{circuit_input::FromU256, circuit_inputs};
use ruint::aliases::U256;
use thiserror::Error;
use tracing::info;

use crate::{
    crypto::{
        keys::{NullifyingKey, SpendingPublicKey, U256Key},
        railgun_txid::Txid,
    },
    railgun::{
        merkle_tree::{
            MerkleProof, MerkleRoot, MerkleTree, MerkleTreeError, TREE_DEPTH, TxidLeafHash,
            TxidMerkleTree, UtxoMerkleTree, UtxoTreeIndex, merkle_proof::new_pre_inclusion,
        },
        note::{IncludedNote, Note},
        poi::{ListKey, PoiNote},
    },
};

// TODO: Consider making me into an enum with two variants on a generic Inner, so
// the values can be [_; 3] / [_; 13] instead of Vec<_> with padding.
#[derive(Debug)]
pub struct PoiCircuitInputs {
    // Public Inputs
    /// The pre-inclusion Merkle root of the txid
    pub railgun_txid_merkleroot_after_transaction: MerkleRoot,
    /// POI Merkle roots from the blinded commitment proofs, from
    /// `poi_client::merkle_proofs`. A seperate padded version is
    /// kept for circuit inputs.
    pub poi_merkleroots: Vec<MerkleRoot>,
    poi_merkleroots_padded: Vec<MerkleRoot>,

    // Private inputs

    // Railgun Transaction info
    bound_params_hash: U256,

    //? Public so the prover can calculate input / output sizes for circuit
    //? selection.
    pub nullifiers: Vec<U256>,
    pub commitments: Vec<U256>,

    // Spender wallet info
    spending_public_key: [U256; 2],
    nullifying_key: U256,

    // Nullified notes data
    token: U256,
    randoms_in: Vec<U256>,
    values_in: Vec<U256>,
    utxo_positions_in: Vec<U256>,
    utxo_tree_in: U256,

    // Commitment notes data
    npks_out: Vec<U256>,
    values_out: Vec<U256>,
    utxo_batch_global_start_position_out: U256,

    // Unshield data
    pub railgun_txid_if_has_unshield: Txid,
    railgun_txid_merkle_proof_indices: U256,
    railgun_txid_merkle_proof_path_elements: Vec<U256>,

    // POI tree
    poi_in_merkle_proof_indices: Vec<U256>,
    poi_in_merkle_proof_path_elements: Vec<Vec<U256>>,

    // Helper fields. Not part of circuit inputs, but useful in other contexts
    pub txid: Txid,
    pub txid_leaf_hash: TxidLeafHash,
}

#[derive(Debug, Error)]
pub enum PoiCircuitInputsError {
    #[error("Invalid input: {0}")]
    InvalidInput(String),
    #[error("Merkle tree error: {0}")]
    MerkleTree(#[from] MerkleTreeError),
    #[error("Missing POI proofs for list key {0}")]
    MissingPoiProofs(ListKey),
}

/// Determines the circuit size based on the number of nullifiers and commitments.
/// Returns 3 for the "mini" circuit, 13 for the "full" circuit.
fn circuit_size(nullifiers_len: usize, commitments_len: usize) -> usize {
    if nullifiers_len <= 3 && commitments_len <= 3 {
        3
    } else {
        13
    }
}

/// Pads a vector with the railgun merkle tree zero value.
fn pad_with_zero_value<T>(vec: Vec<T>, target_len: usize) -> Vec<T>
where
    T: FromU256,
{
    pad_with_value(vec, target_len, MerkleTree::zero())
}

fn pad_with_zero<T>(vec: Vec<T>, target_len: usize) -> Vec<T>
where
    T: FromU256,
{
    pad_with_value(vec, target_len, U256::from(0))
}

fn pad_with_value<T>(mut vec: Vec<T>, target_len: usize, value: U256) -> Vec<T>
where
    T: FromU256,
{
    while vec.len() < target_len {
        vec.push(T::from_u256(value));
    }
    vec
}

fn pad_merkle_proof_paths<T>(mut vec: Vec<Vec<T>>, target_len: usize) -> Vec<Vec<T>>
where
    T: FromU256 + Clone,
{
    let zero = T::from_u256(MerkleTree::zero());
    let empty_path: Vec<T> = vec![zero; TREE_DEPTH];

    while vec.len() < target_len {
        vec.push(empty_path.clone());
    }

    vec
}

impl PoiCircuitInputs {
    /// Builds POI circuit inputs for the pre-transaction proof using dummy
    /// pre-inclusion TXID values. Used when submitting to the broadcaster.
    #[allow(clippy::too_many_arguments)]
    pub fn from_inputs(
        spending_pubkey: SpendingPublicKey,
        nullifying_key: NullifyingKey,
        utxo_merkle_tree: &UtxoMerkleTree,
        utxo_tree_in: u32,
        bound_params_hash: U256,
        in_notes: &[PoiNote],
        out_commitments: &[U256],
        out_npks: &[U256],
        out_values: &[U256],
        token: U256,
        has_unshield: bool,
        list_key: ListKey,
    ) -> Result<Self, PoiCircuitInputsError> {
        let nullifiers = Self::compute_nullifiers(utxo_merkle_tree, in_notes)?;
        let txid = Txid::new(&nullifiers, out_commitments, bound_params_hash);
        let tree_index = UtxoTreeIndex::PreInclusion;
        let txid_leaf_hash = TxidLeafHash::new(txid, utxo_tree_in, tree_index);
        let txid_proof = new_pre_inclusion(txid_leaf_hash.into());
        Self::assemble(
            spending_pubkey,
            nullifying_key,
            bound_params_hash,
            utxo_tree_in,
            in_notes,
            out_commitments,
            out_npks,
            out_values,
            token,
            has_unshield,
            list_key,
            nullifiers,
            txid,
            txid_leaf_hash,
            tree_index,
            txid_proof,
        )
    }

    /// Builds POI circuit inputs for the post-transaction re-proof using the
    /// actual on-chain TXID position. Used when submitting to the POI aggregator.
    #[allow(clippy::too_many_arguments)]
    pub fn from_inputs_included<S>(
        spending_pubkey: SpendingPublicKey,
        nullifying_key: NullifyingKey,
        utxo_merkle_tree: &UtxoMerkleTree,
        utxo_tree_in: u32,
        bound_params_hash: U256,
        in_notes: &[PoiNote<S>],
        out_commitments: &[U256],
        out_npks: &[U256],
        out_values: &[U256],
        token: U256,
        has_unshield: bool,
        list_key: ListKey,
        included_index: UtxoTreeIndex,
        txid_tree: &TxidMerkleTree,
    ) -> Result<Self, PoiCircuitInputsError> {
        let nullifiers = Self::compute_nullifiers(utxo_merkle_tree, in_notes)?;
        let txid = Txid::new(&nullifiers, out_commitments, bound_params_hash);
        let txid_leaf_hash = TxidLeafHash::new(txid, utxo_tree_in, included_index);
        let txid_proof = txid_tree.generate_proof(txid_leaf_hash)?;
        Self::assemble(
            spending_pubkey,
            nullifying_key,
            bound_params_hash,
            utxo_tree_in,
            in_notes,
            out_commitments,
            out_npks,
            out_values,
            token,
            has_unshield,
            list_key,
            nullifiers,
            txid,
            txid_leaf_hash,
            included_index,
            txid_proof,
        )
    }

    fn compute_nullifiers<S>(
        utxo_merkle_tree: &UtxoMerkleTree,
        in_notes: &[PoiNote<S>],
    ) -> Result<Vec<U256>, PoiCircuitInputsError> {
        info!("UTXO proofs");
        let utxo_proofs: Vec<_> = in_notes
            .iter()
            .map(|note| utxo_merkle_tree.generate_proof(note.hash()))
            .collect::<Result<_, _>>()?;

        info!("Computing nullifiers");
        Ok(in_notes
            .iter()
            .zip(utxo_proofs.iter())
            .map(|(note, proof)| note.nullifier(proof.indices))
            .collect())
    }

    #[allow(clippy::too_many_arguments)]
    fn assemble<S>(
        spending_pubkey: SpendingPublicKey,
        nullifying_pubkey: NullifyingKey,
        bound_params_hash: U256,
        utxo_tree_in: u32,
        in_notes: &[PoiNote<S>],
        out_commitments: &[U256],
        out_npks: &[U256],
        out_values: &[U256],
        token: U256,
        has_unshield: bool,
        list_key: ListKey,
        nullifiers: Vec<U256>,
        txid: Txid,
        txid_leaf_hash: TxidLeafHash,
        tree_index: UtxoTreeIndex,
        txid_proof: MerkleProof,
    ) -> Result<Self, PoiCircuitInputsError> {
        // Per-note POI proofs
        info!("Generating POI proofs");
        let poi_proofs = in_notes
            .iter()
            .map(|n| {
                n.poi_merkle_proofs()
                    .get(&list_key)
                    .ok_or(PoiCircuitInputsError::MissingPoiProofs(list_key.clone()))
            })
            .collect::<Result<Vec<_>, _>>()?;

        info!("Assembling circuit inputs");
        let poi_merkleroots: Vec<MerkleRoot> = poi_proofs.iter().map(|p| p.root).collect();
        let poi_in_merkle_proof_indices =
            poi_proofs.iter().map(|p| U256::from(p.indices)).collect();
        let poi_in_merkle_proof_path_elements =
            poi_proofs.iter().map(|p| p.elements.clone()).collect();

        let randoms_in = in_notes
            .iter()
            .map(|n| U256::from_be_slice(&n.random()))
            .collect();
        let values_in = in_notes.iter().map(|n| U256::from(n.value())).collect();
        let utxo_positions_in = in_notes
            .iter()
            .map(|n| U256::from(n.leaf_index()))
            .collect();

        let txid_if_has_unshield = if has_unshield {
            txid
        } else {
            U256::from(0).into()
        };

        let max_size = circuit_size(nullifiers.len(), out_commitments.len());

        Ok(PoiCircuitInputs {
            railgun_txid_merkleroot_after_transaction: txid_proof.root,
            poi_merkleroots: poi_merkleroots.clone(),
            poi_merkleroots_padded: pad_with_zero_value(poi_merkleroots, max_size),
            bound_params_hash,
            nullifiers: pad_with_zero_value(nullifiers, max_size),
            commitments: pad_with_zero_value(out_commitments.to_vec(), max_size),
            spending_public_key: [spending_pubkey.x_u256(), spending_pubkey.y_u256()],
            nullifying_key: nullifying_pubkey.to_u256(),
            token,
            randoms_in: pad_with_zero_value(randoms_in, max_size),
            values_in: pad_with_zero(values_in, max_size),
            utxo_positions_in: pad_with_zero_value(utxo_positions_in, max_size),
            utxo_tree_in: U256::from(utxo_tree_in),
            npks_out: pad_with_zero_value(out_npks.to_vec(), max_size),
            values_out: pad_with_zero(out_values.to_vec(), max_size),
            utxo_batch_global_start_position_out: U256::from(tree_index.global_index()),
            railgun_txid_if_has_unshield: txid_if_has_unshield,
            railgun_txid_merkle_proof_indices: U256::from(txid_proof.indices),
            railgun_txid_merkle_proof_path_elements: txid_proof.elements,
            poi_in_merkle_proof_indices: pad_with_zero(poi_in_merkle_proof_indices, max_size),
            poi_in_merkle_proof_path_elements: pad_merkle_proof_paths(
                poi_in_merkle_proof_path_elements,
                max_size,
            ),
            txid,
            txid_leaf_hash,
        })
    }

    circuit_inputs!(
        railgun_txid_merkleroot_after_transaction => "anyRailgunTxidMerklerootAfterTransaction",
        bound_params_hash => "boundParamsHash",
        nullifiers => "nullifiers",
        commitments => "commitmentsOut",
        spending_public_key => "spendingPublicKey",
        nullifying_key => "nullifyingKey",
        token => "token",
        randoms_in => "randomsIn",
        values_in => "valuesIn",
        utxo_positions_in => "utxoPositionsIn",
        utxo_tree_in => "utxoTreeIn",
        npks_out => "npksOut",
        values_out => "valuesOut",
        utxo_batch_global_start_position_out => "utxoBatchGlobalStartPositionOut",
        railgun_txid_if_has_unshield => "railgunTxidIfHasUnshield",
        railgun_txid_merkle_proof_indices => "railgunTxidMerkleProofIndices",
        railgun_txid_merkle_proof_path_elements => "railgunTxidMerkleProofPathElements",
        poi_merkleroots_padded => "poiMerkleroots",
        poi_in_merkle_proof_indices => "poiInMerkleProofIndices",
        poi_in_merkle_proof_path_elements => "poiInMerkleProofPathElements"
    );
}

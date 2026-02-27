use std::{collections::BTreeSet, fmt::Debug};

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{info, warn};

use crate::merkle_tree::{
    config::MerkleConfig,
    merkle_proof::{MerkleProof, MerkleRoot},
};

/// Configurable sparse Merkle tree implementation with fixed depth and zero values
#[derive(Debug, Clone)]
pub struct MerkleTree<C: MerkleConfig> {
    number: u32,
    zeros: Vec<U256>,
    tree: Vec<Vec<U256>>,
    dirty_parents: BTreeSet<usize>,

    phantom: std::marker::PhantomData<C>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MerkleTreeState<C: MerkleConfig> {
    pub number: u32,
    pub tree: Vec<Vec<U256>>,

    #[serde(skip)]
    phantom: std::marker::PhantomData<C>,
}

#[derive(Debug, Error)]
pub enum MerkleTreeError {
    #[error("Element not found in tree: {0}")]
    ElementNotFound(String),
    #[error("Invalid proof")]
    InvalidProof,
}

impl<C: MerkleConfig> MerkleTree<C> {
    pub fn new(tree_number: u32) -> Self {
        let zeros = zero_value_levels::<C>();
        let mut tree: Vec<Vec<U256>> = (0..=C::DEPTH).map(|_| Vec::new()).collect();

        let root = C::hash(zeros[C::DEPTH - 1], zeros[C::DEPTH - 1]);
        tree[C::DEPTH].insert(0, root);
        MerkleTree::<C> {
            number: tree_number,
            zeros,
            tree,
            dirty_parents: BTreeSet::new(),
            phantom: std::marker::PhantomData,
        }
    }

    pub fn depth() -> usize {
        C::DEPTH
    }

    pub fn total_leaves() -> usize {
        1 << C::DEPTH
    }

    pub fn zero() -> U256 {
        C::zero()
    }

    pub fn from_state(state: MerkleTreeState<C>) -> Self {
        let mut tree = MerkleTree::<C>::new(state.number);
        tree.tree = state.tree;
        tree
    }

    pub fn number(&self) -> u32 {
        self.number
    }

    pub fn root(&self) -> MerkleRoot {
        debug_assert!(
            self.dirty_parents.is_empty(),
            "Merkle tree has dirty parents, root may be outdated"
        );

        self.tree[C::DEPTH][0].into()
    }

    /// Returns the current number of leaves in the sparse tree
    pub fn leaves_len(&self) -> usize {
        self.tree[0].len()
    }

    pub fn state(&self) -> MerkleTreeState<C> {
        self.clone().into_state()
    }

    pub fn into_state(self) -> MerkleTreeState<C> {
        MerkleTreeState::<C> {
            number: self.number,
            tree: self.tree,
            phantom: std::marker::PhantomData,
        }
    }

    pub fn generate_proof(&self, element: U256) -> Result<MerkleProof<C>, MerkleTreeError> {
        debug_assert!(
            self.dirty_parents.is_empty(),
            "Merkle tree has dirty parents, root may be outdated"
        );

        if !self.dirty_parents.is_empty() {
            warn!("Merkle tree has dirty parents, root may be outdated");
        }

        let initial_index = self.tree[0]
            .iter()
            .position(|val| *val == element)
            .ok_or(MerkleTreeError::ElementNotFound(format!("{:?}", element)))?;

        let mut elements = Vec::with_capacity(C::DEPTH);
        let mut index = initial_index;

        for level in 0..C::DEPTH {
            let is_left_child = index % 2 == 0;
            let siblings_index = if is_left_child { index + 1 } else { index - 1 };

            let sibling = self.tree[level]
                .get(siblings_index)
                .copied()
                .unwrap_or(self.zeros[level]);

            elements.push(sibling);
            index /= 2;
        }

        let proof = MerkleProof::new(element, elements, U256::from(initial_index), self.root());
        if !proof.verify() {
            return Err(MerkleTreeError::InvalidProof);
        }

        Ok(proof)
    }

    /// Insert one leaf and immediately rebuilds.
    pub fn insert_leaf(&mut self, leaf: U256, position: usize) {
        self.insert_leaves_raw(&[leaf], position);
        self.rebuild();
    }

    /// Inserts leaves starting at the given position without rebuilding.
    pub fn insert_leaves_raw(&mut self, leaves: &[U256], start_position: usize) {
        if leaves.is_empty() {
            return;
        }

        let end_position = start_position + leaves.len();
        if self.tree[0].len() < end_position {
            self.tree[0].resize(end_position, self.zeros[0]);
        }

        for (i, leaf) in leaves.iter().enumerate() {
            let leaf_index = start_position + i;
            self.tree[0][leaf_index] = *leaf;
            self.dirty_parents.insert(leaf_index / 2);
        }
    }

    pub fn rebuild(&mut self) {
        if self.dirty_parents.is_empty() {
            return;
        }

        info!("Rebuilding Merkle tree {}", self.number);
        let mut dirty = std::mem::take(&mut self.dirty_parents);

        for level in 0..C::DEPTH {
            let child_width = self.tree[level].len();
            let parent_width = child_width.div_ceil(2);

            if self.tree[level + 1].len() < parent_width {
                self.tree[level + 1].resize(parent_width, self.zeros[level + 1]);
            }

            let mut next_dirty = BTreeSet::new();

            for &parent_idx in &dirty {
                let left_idx = parent_idx * 2;
                let right_idx = left_idx + 1;

                let left = if left_idx < child_width {
                    self.tree[level][left_idx]
                } else {
                    self.zeros[level]
                };
                let right = if right_idx < child_width {
                    self.tree[level][right_idx]
                } else {
                    self.zeros[level]
                };

                self.tree[level + 1][parent_idx] = C::hash(left, right);
                next_dirty.insert(parent_idx / 2);
            }

            dirty = next_dirty;
        }
    }
}

fn zero_value_levels<C: MerkleConfig>() -> Vec<U256> {
    let mut levels = Vec::with_capacity(C::DEPTH + 1);
    let mut current = C::zero();

    for _ in 0..=C::DEPTH {
        levels.push(current);
        current = C::hash(current, current);
    }

    levels
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::merkle_tree::config::TestMerkleConfig;

    #[test]
    fn test_merkle_tree() {
        let mut tree = MerkleTree::<TestMerkleConfig>::new(0);
        let leaves = vec![U256::from(1), U256::from(2), U256::from(3), U256::from(4)];
        tree.insert_leaves_raw(&leaves, 0);
        tree.rebuild();

        insta::assert_debug_snapshot!(tree.state());
    }

    #[test]
    fn test_serialize_deserialize() {
        let mut tree = MerkleTree::<TestMerkleConfig>::new(0);
        let leaves = vec![U256::from(1), U256::from(2), U256::from(3), U256::from(4)];
        tree.insert_leaves_raw(&leaves, 0);
        tree.rebuild();

        let state = tree.state();
        let deserialized_tree = MerkleTree::<TestMerkleConfig>::from_state(state.clone());
        assert_eq!(tree.state(), deserialized_tree.state());
    }
}

use crate::railgun::merkle_tree::TOTAL_LEAVES;

/// Normalize a tree number and leaf index to ensure the leaf index isn't overflowing the tree
pub fn normalize_tree_position(tree_number: u32, leaf_index: u32) -> (u32, u32) {
    let global = tree_number as u64 * TOTAL_LEAVES as u64 + leaf_index as u64;

    let normalized_tree_number = (global / TOTAL_LEAVES as u64) as u32;
    let normalized_leaf_index = (global % TOTAL_LEAVES as u64) as u32;

    (normalized_tree_number, normalized_leaf_index)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_position() {
        // No overflow
        assert_eq!(normalize_tree_position(0, 0), (0, 0));
        assert_eq!(normalize_tree_position(1, 10), (1, 10));

        // Overflow
        assert_eq!(normalize_tree_position(0, TOTAL_LEAVES as u32), (1, 0));
        assert_eq!(normalize_tree_position(2, TOTAL_LEAVES as u32 + 5), (3, 5));
    }
}

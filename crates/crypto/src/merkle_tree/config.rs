use std::fmt::Debug;

use alloy::primitives::U256;

pub trait MerkleConfig: Debug + Clone + PartialEq + Eq {
    const DEPTH: usize;

    fn hash(left: U256, right: U256) -> U256;
    fn zero() -> U256;
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestMerkleConfig;

#[cfg(test)]
impl MerkleConfig for TestMerkleConfig {
    const DEPTH: usize = 4;

    fn hash(left: U256, right: U256) -> U256 {
        left ^ right
    }

    fn zero() -> U256 {
        U256::from(0)
    }
}

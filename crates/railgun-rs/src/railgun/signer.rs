use std::{fmt::Debug, sync::Arc};

use ruint::aliases::U256;

use crate::{
    crypto::keys::{SpendingKey, SpendingSignature, ViewingKey},
    railgun::address::{ChainId, RailgunAddress},
};

pub trait Signer: SpendingKeyProvider + ViewingKeyProvider {
    fn sign(&self, inputs: U256) -> SpendingSignature;
    fn address(&self) -> RailgunAddress;
}

pub trait SpendingKeyProvider {
    fn spending_key(&self) -> SpendingKey;
}

pub trait ViewingKeyProvider {
    fn viewing_key(&self) -> ViewingKey;
}

pub struct PrivateKeySigner {
    pub spending_key: SpendingKey,
    pub viewing_key: ViewingKey,
    pub chain_id: ChainId,
}

pub fn derivation_paths(index: u32) -> (String, String) {
    let spending_path = format!("m/44'/1984'/0'/0'/{}", index);
    let viewing_path = format!("m/420'/1984'/0'/0'/{}", index);
    (spending_path, viewing_path)
}

impl PrivateKeySigner {
    pub fn new(spending_key: SpendingKey, viewing_key: ViewingKey, chain_id: ChainId) -> Arc<Self> {
        Arc::new(Self {
            spending_key,
            viewing_key,
            chain_id,
        })
    }

    pub fn new_evm(spending_key: SpendingKey, viewing_key: ViewingKey, chain_id: u64) -> Arc<Self> {
        Self::new(spending_key, viewing_key, ChainId::EVM(chain_id))
    }
}

impl SpendingKeyProvider for PrivateKeySigner {
    fn spending_key(&self) -> SpendingKey {
        self.spending_key
    }
}

impl ViewingKeyProvider for PrivateKeySigner {
    fn viewing_key(&self) -> ViewingKey {
        self.viewing_key
    }
}

impl Signer for PrivateKeySigner {
    fn sign(&self, inputs: U256) -> SpendingSignature {
        self.spending_key.sign(inputs)
    }

    fn address(&self) -> RailgunAddress {
        RailgunAddress::from_private_keys(self.spending_key, self.viewing_key, self.chain_id)
    }
}

impl Debug for dyn Signer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Signer(address: {})", self.address())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_derivation_paths() {
        let index = 5;
        let (spending_path, viewing_path) = derivation_paths(index);
        assert_eq!(spending_path, "m/44'/1984'/0'/0'/5");
        assert_eq!(viewing_path, "m/420'/1984'/0'/0'/5");
    }
}

use std::{fmt::Debug, sync::Arc};

use ruint::aliases::U256;
use thiserror::Error;

use crate::{
    crypto::keys::{SpendingKey, SpendingSignature, ViewingKey},
    railgun::{address::RailgunAddress, chain::ChainId},
};

#[derive(Debug, Error)]
pub enum RailgunSignerError {
    #[error("Signing error: {0}")]
    SigningError(#[source] Box<dyn std::error::Error + Send + Sync>),
}

/// A railgun signer which can sign transactions and provide the associated 0xzk address.
pub trait RailgunSigner: SpendingKeyProvider + ViewingKeyProvider {
    fn sign(&self, inputs: U256) -> Result<SpendingSignature, RailgunSignerError>;
    fn chain_id(&self) -> ChainId;

    fn address(&self) -> RailgunAddress {
        RailgunAddress::from_private_keys(self.spending_key(), self.viewing_key(), self.chain_id())
    }
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
    let spending_path = format!("m/44'/1984'/0'/0'/{}'", index);
    let viewing_path = format!("m/420'/1984'/0'/0'/{}'", index);
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
        Self::new(spending_key, viewing_key, ChainId::evm(chain_id))
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

impl RailgunSigner for PrivateKeySigner {
    fn sign(&self, inputs: U256) -> Result<SpendingSignature, RailgunSignerError> {
        Ok(self.spending_key.sign(inputs))
    }

    fn chain_id(&self) -> ChainId {
        self.chain_id
    }
}

impl Debug for dyn RailgunSigner {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Signer(address: {})", self.address())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crypto::keys::HexKey;

    #[test]
    fn test_derivation_paths() {
        let index = 5;
        let (spending_path, viewing_path) = derivation_paths(index);
        assert_eq!(spending_path, "m/44'/1984'/0'/0'/5'");
        assert_eq!(viewing_path, "m/420'/1984'/0'/0'/5'");
    }

    #[test]
    fn test_address() {
        let spending_key = SpendingKey::from_hex(
            "039b3b11110e49d7340cbe7171791972e3c0d94ef31b18d6ab93d7ace62d278a",
        )
        .unwrap();
        let viewing_key = ViewingKey::from_hex(
            "d345b2cc2f414aa93413b9572fa2b26e0e869e9274b006415a8d62ab1fa2dcb1",
        )
        .unwrap();

        let signer = PrivateKeySigner::new(spending_key, viewing_key, ChainId::All);
        let address = signer.address();
        assert_eq!(
            address.to_string(),
            "0zk1qynw6pq3nvntq90sts0khgs8ndqxzsrza88cd553dqwt28mskxlxtrv7j6fe3z53l7lczqdhfmfffxa8cps4hw7nprhx3hv3ykx097l8p7gjh2xla365qacrwu2"
        );
    }
}

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
    spending_key: SpendingKey,
    viewing_key: ViewingKey,
    chain_id: ChainId,
}

impl Debug for dyn Signer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Signer(address: {})", self.address())
    }
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

use std::sync::Arc;

use rand::random;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    crypto::keys::{HexKey, SpendingKey, ViewingKey},
    railgun::{PrivateKeySigner, Signer, address::RailgunAddress},
};

#[wasm_bindgen]
pub struct JsSigner {
    //? Inner func used so we can clone the arc
    inner: Arc<PrivateKeySigner>,
}

#[wasm_bindgen]
impl JsSigner {
    /// Create a new Railgun signer from hex-encoded keys.
    ///
    /// @param spending_key - 32-byte hex string (with or without 0x prefix)
    /// @param viewing_key - 32-byte hex string (with or without 0x prefix)
    /// @param chain_id - The chain ID for this account
    #[wasm_bindgen(constructor)]
    pub fn new(spending_key: &str, viewing_key: &str, chain_id: u64) -> Result<JsSigner, JsValue> {
        let spending_key = SpendingKey::from_hex(spending_key)?;
        let viewing_key = ViewingKey::from_hex(viewing_key)?;
        Ok(PrivateKeySigner::new_evm(spending_key, viewing_key, chain_id).into())
    }

    pub fn random(chain_id: u64) -> JsSigner {
        PrivateKeySigner::new_evm(random(), random(), chain_id).into()
    }

    /// The Railgun address (0zk...) for this account
    #[wasm_bindgen(getter)]
    pub fn address(&self) -> RailgunAddress {
        self.inner.address()
    }
}

impl JsSigner {
    pub(crate) fn inner(&self) -> Arc<PrivateKeySigner> {
        self.inner.clone()
    }
}

impl From<Arc<PrivateKeySigner>> for JsSigner {
    fn from(signer: Arc<PrivateKeySigner>) -> Self {
        JsSigner { inner: signer }
    }
}

use std::sync::Arc;

use railgun_rs::{
    account::{
        address::RailgunAddress,
        chain::ChainId,
        signer::{PrivateKeySigner, RailgunSigner},
    },
    crypto::keys::{HexKey, SpendingKey, ViewingKey},
};
use rand::random;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

#[wasm_bindgen(js_name = "RailgunSigner")]
pub struct JsRailgunSigner {
    inner: Arc<dyn RailgunSigner>,
}

#[wasm_bindgen(js_class = "RailgunSigner")]
impl JsRailgunSigner {
    #[wasm_bindgen(js_name = "privateKey")]
    pub fn new_private_key(
        #[wasm_bindgen(unchecked_param_type = "`0x${string}`")] spending_key: String,
        #[wasm_bindgen(unchecked_param_type = "`0x${string}`")] viewing_key: String,
        chain_id: Option<u64>,
    ) -> Result<Self, JsError> {
        let spending_key = SpendingKey::from_hex(&spending_key)
            .map_err(|e| JsError::new(&format!("Invalid spending key hex: {}", e)))?;
        let viewing_key = ViewingKey::from_hex(&viewing_key)
            .map_err(|e| JsError::new(&format!("Invalid viewing key hex: {}", e)))?;

        let chain_id = match chain_id {
            Some(id) => ChainId::evm(id),
            None => ChainId::All,
        };

        Ok(Self {
            inner: PrivateKeySigner::new(spending_key, viewing_key, chain_id),
        })
    }

    #[wasm_bindgen(js_name = "random")]
    pub fn new_random(chain_id: Option<u64>) -> Self {
        let chain_id = match chain_id {
            Some(id) => ChainId::evm(id),
            None => ChainId::All,
        };

        Self {
            inner: PrivateKeySigner::new(random(), random(), chain_id),
        }
    }

    #[wasm_bindgen(getter)]
    pub fn address(&self) -> RailgunAddress {
        self.inner.address()
    }

    #[wasm_bindgen(getter)]
    pub fn chain_id(&self) -> Option<u64> {
        match self.inner.chain_id() {
            ChainId::Evm { id } => Some(id),
            _ => None,
        }
    }

    #[wasm_bindgen(
        getter,
        js_name = "spendingKey",
        unchecked_return_type = "`0x${string}`"
    )]
    pub fn spending_key(&self) -> String {
        self.inner.spending_key().to_hex()
    }

    #[wasm_bindgen(
        getter,
        js_name = "viewingKey",
        unchecked_return_type = "`0x${string}`"
    )]
    pub fn viewing_key(&self) -> String {
        self.inner.viewing_key().to_hex()
    }
}

impl JsRailgunSigner {
    pub fn inner(&self) -> Arc<dyn RailgunSigner> {
        self.inner.clone()
    }
}

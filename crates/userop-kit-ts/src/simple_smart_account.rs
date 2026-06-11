use std::{str::FromStr, sync::Arc};

use alloy::primitives::Address;
use eip_1193_provider::js::JsEip1193Provider;
use userop_kit::smart_account::simple_smart_account::SimpleSmartAccount;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

/// Creates a simple smart account.
///
/// Defaults to the v0.8 EntryPoint and the eth-infinitism Simple7702Account implementation at
/// `0xe6Cae83BdE06E4c305530e199D7217f42808555B`.
#[wasm_bindgen(js_name = "SimpleSmartAccount")]
pub struct JsSimpleSmartAccount {
    inner: SimpleSmartAccount,
}

#[wasm_bindgen(js_class = "SimpleSmartAccount")]
impl JsSimpleSmartAccount {
    #[wasm_bindgen(constructor)]
    pub fn new(
        #[wasm_bindgen(unchecked_param_type = "`0x${string}`")] owner: String,
        chain_id: u64,
        provider: JsEip1193Provider,
    ) -> Result<Self, JsError> {
        let owner = Address::from_str(&owner).map_err(|e| JsError::new(&e.to_string()))?;

        Ok(Self {
            inner: SimpleSmartAccount::new(owner, chain_id, Arc::new(provider)),
        })
    }
}

impl JsSimpleSmartAccount {
    pub fn inner(&self) -> &SimpleSmartAccount {
        &self.inner
    }
}

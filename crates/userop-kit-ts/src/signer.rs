use std::{str::FromStr, sync::Arc};

use alloy::signers::{Signer, local::PrivateKeySigner};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

/// Ethereum Signer
#[wasm_bindgen(js_name = "Signer")]
pub struct JsSigner {
    inner: Arc<dyn Signer>,
}

impl JsSigner {
    pub fn new(inner: Arc<dyn Signer>) -> Self {
        Self { inner }
    }

    pub fn inner(&self) -> &Arc<dyn Signer> {
        &self.inner
    }
}

#[wasm_bindgen(js_class = "Signer")]
impl JsSigner {
    /// Creates a new private key signer
    #[wasm_bindgen(js_name = "privateKey")]
    pub fn new_private_key(
        #[wasm_bindgen(js_name = "privateKey", unchecked_param_type = "`0x${string}`")] private_key: String,
    ) -> Result<JsSigner, JsError> {
        let signer = PrivateKeySigner::from_str(&private_key).map_err(|e| {
            JsError::new(&format!(
                "Failed to create signer from private key: {:?}",
                e
            ))
        })?;
        Ok(JsSigner::new(Arc::new(signer)))
    }

    /// Returns the signer's address
    #[wasm_bindgen(getter, js_name = "address", unchecked_return_type = "`0x${string}`")]
    pub fn address(&self) -> String {
        self.inner.address().to_string()
    }
}

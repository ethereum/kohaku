use userop_kit::{
    signable_user_operation::SignableUserOperation, signed_user_operation::SignedUserOperation,
    user_operation::UserOperation,
};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::signer::JsSigner;

#[wasm_bindgen(js_name = "SignableUserOperation")]
pub struct JsSignableUserOperation {
    inner: SignableUserOperation,
}

impl JsSignableUserOperation {
    pub fn new(inner: SignableUserOperation) -> Self {
        Self { inner }
    }

    pub fn inner(&self) -> &SignableUserOperation {
        &self.inner
    }
}

#[wasm_bindgen(js_class = "SignableUserOperation")]
impl JsSignableUserOperation {
    #[wasm_bindgen(getter, js_name = "userOp")]
    pub fn user_op(&self) -> UserOperation {
        self.inner.user_op.clone()
    }

    #[wasm_bindgen(
        getter,
        js_name = "entryPoint",
        unchecked_return_type = "`0x${string}`"
    )]
    pub fn entry_point(&self) -> String {
        self.inner.entry_point.to_string()
    }

    pub async fn sign(&self, signer: &JsSigner) -> Result<SignedUserOperation, JsError> {
        self.inner
            .sign(signer.inner().as_ref())
            .await
            .map_err(|e| JsError::new(&format!("Failed to sign user operation: {:?}", e)))
    }
}

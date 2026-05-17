use thiserror::Error;

use crate::{
    signable_user_operation::SignableUserOperation,
    signed_user_operation::SignedUserOperation,
    user_operation::{UserOperationGasEstimate, UserOperationHash, UserOperationReceipt},
};

#[derive(Debug, Error)]
pub enum BundlerError {
    #[error("Timeout")]
    Timeout,
    #[error("Other: {0}")]
    Other(#[from] Box<dyn std::error::Error + Send + Sync>),
}

/// A bundler provider for 4337 UserOperation JSON-RPC methods.
#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait Bundler {
    async fn suggest_max_fee_per_gas(&self) -> Result<u128, BundlerError>;
    async fn suggest_max_priority_fee_per_gas(&self) -> Result<u128, BundlerError>;
    async fn estimate_gas(
        &self,
        op: &SignableUserOperation,
    ) -> Result<UserOperationGasEstimate, BundlerError>;
    async fn send_user_operation(
        &self,
        op: &SignedUserOperation,
    ) -> Result<UserOperationHash, BundlerError>;
    async fn wait_for_receipt(
        &self,
        hash: UserOperationHash,
    ) -> Result<UserOperationReceipt, BundlerError>;
}

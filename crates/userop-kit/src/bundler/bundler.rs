use thiserror::Error;

use crate::{
    builder::UserOperationBuilder,
    signable_user_operation::SignableUserOperation,
    signed_user_operation::SignedUserOperation,
    user_operation::{UserOperationGasEstimate, UserOperationHash, UserOperationReceipt},
};

pub trait BundlerExt: Sized {
    /// Fetches a gas estimate from the provider for the current UserOp.
    fn with_gas_estimate(
        self,
        bundler: &dyn Bundler,
    ) -> impl Future<Output = Result<Self, BundlerError>>;
}

/// A bundler provider for 4337 UserOperation JSON-RPC methods.
#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait Bundler {
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

#[derive(Debug, Error)]
pub enum BundlerError {
    #[error("Timeout")]
    Timeout,
    #[error("Other: {0}")]
    Other(#[from] Box<dyn std::error::Error + Send + Sync>),
}

impl<S> BundlerExt for UserOperationBuilder<S> {
    async fn with_gas_estimate(self, bundler: &dyn Bundler) -> Result<Self, BundlerError> {
        let op = self.build();
        let est = bundler.estimate_gas(&op).await?;

        Ok(self.with_gas(est))
    }
}

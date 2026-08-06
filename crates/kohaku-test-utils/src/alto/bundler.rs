use userop_kit::{
    bundler::{Bundler, BundlerError, pimlico::PimlicoBundler},
    signable_user_operation::SignableUserOperation,
    signed_user_operation::SignedUserOperation,
    user_operation::{UserOperationGasEstimate, UserOperationHash, UserOperationReceipt},
};

/// Helper for spawning an Alto process in tests, doubling as a `Bundler` for
/// the process it spawned.
pub struct AltoBundler {
    pub(super) process: std::process::Child,
    pub(super) bundler: PimlicoBundler,
}

#[async_trait::async_trait]
impl Bundler for AltoBundler {
    async fn estimate_gas(
        &self,
        op: &SignableUserOperation,
    ) -> Result<UserOperationGasEstimate, BundlerError> {
        self.bundler.estimate_gas(op).await
    }

    async fn send_user_operation(
        &self,
        op: &SignedUserOperation,
    ) -> Result<UserOperationHash, BundlerError> {
        self.bundler.send_user_operation(op).await
    }

    async fn wait_for_receipt(
        &self,
        hash: UserOperationHash,
    ) -> Result<UserOperationReceipt, BundlerError> {
        self.bundler.wait_for_receipt(hash).await
    }
}

impl Drop for AltoBundler {
    fn drop(&mut self) {
        let _ = self.process.kill();
    }
}

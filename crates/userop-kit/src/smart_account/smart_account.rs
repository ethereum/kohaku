use alloy::{
    primitives::{Address, Bytes, U256},
    rpc::types::Authorization,
};
use alloy_sol_types::Eip712Domain;
use eip_1193_provider::provider::Eip1193Error;

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
pub trait SmartAccount {
    type CallData;

    /// Get the address of this smart account.
    fn address(&self) -> Address;

    /// 4337 EntryPoint address for this smart account.
    fn entry_point(&self) -> Address;

    /// EIP-712 domain for this smart account, which is used for signing UserOperations.
    fn domain(&self) -> Eip712Domain;

    /// 4337 nonce for this smart account.
    async fn nonce(&self) -> Result<U256, SmartAccountError>;

    /// EIP-7702 authorization for this smart account.
    async fn authorization(&self) -> Result<Authorization, SmartAccountError>;

    /// Returns a dummy signature that can be used for gas estimation.
    fn dummy_signature(&self) -> Bytes;

    /// Encodes the provided call data into the format expected by this smart account's EntryPoint.
    fn encode_call_data(&self, call_data: Self::CallData) -> Bytes;
}

#[derive(Debug, thiserror::Error)]
pub enum SmartAccountError {
    #[error("EIP-1193 error: {0}")]
    Eip1193Error(#[from] Eip1193Error),
    // #[error(transparent)]
    // Other(#[from] anyhow::Error),
}

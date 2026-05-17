use alloy::primitives::B256;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use tracing::info;

use crate::{
    bundler::{
        bundler::{Bundler, BundlerError},
        rpc_client::{RpcClient, RpcClientError},
    },
    signable_user_operation::SignableUserOperation,
    signed_user_operation::SignedUserOperation,
    user_operation::{UserOperationGasEstimate, UserOperationHash, UserOperationReceipt},
};

/// A bundler provider for Pimlico.
pub struct PimlicoBundler {
    client: RpcClient,
}

/// Errors from the bundler SDK.
#[derive(Debug, thiserror::Error)]
pub enum PimlicoError {
    #[error("Transport error: {0}")]
    Transport(#[from] RpcClientError),

    #[error("Abi error: {0}")]
    Abi(#[from] alloy::sol_types::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PimlicoUserOperationGasEstimate {
    pub slow: PimlicoSpeedGasEstimate,
    pub standard: PimlicoSpeedGasEstimate,
    pub fast: PimlicoSpeedGasEstimate,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PimlicoSpeedGasEstimate {
    #[serde(with = "alloy::serde::quantity")]
    pub max_fee_per_gas: u128,
    #[serde(with = "alloy::serde::quantity")]
    pub max_priority_fee_per_gas: u128,
}

impl PimlicoBundler {
    pub fn new(bundler_url: Url) -> Self {
        Self {
            client: RpcClient::new(bundler_url),
        }
    }
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
impl Bundler for PimlicoBundler {
    async fn suggest_max_fee_per_gas(&self) -> Result<u128, BundlerError> {
        info!("Requesting max fee estimate from Pimlico...");
        let estimate: PimlicoUserOperationGasEstimate = self
            .client
            .request("pimlico_getUserOperationGasPrice", serde_json::json!([]))
            .await
            .map_err(|e| BundlerError::Other(Box::new(e)))?;

        Ok(estimate.standard.max_fee_per_gas)
    }

    async fn suggest_max_priority_fee_per_gas(&self) -> Result<u128, BundlerError> {
        info!("Requesting max priority fee estimate from Pimlico...");
        let estimate: PimlicoUserOperationGasEstimate = self
            .client
            .request("pimlico_getUserOperationGasPrice", serde_json::json!([]))
            .await
            .map_err(|e| BundlerError::Other(Box::new(e)))?;

        Ok(estimate.standard.max_priority_fee_per_gas)
    }

    async fn estimate_gas(
        &self,
        op: &SignableUserOperation,
    ) -> Result<UserOperationGasEstimate, BundlerError> {
        info!("Requesting gas estimate from Pimlico...");

        Ok(self
            .client
            .request(
                "eth_estimateUserOperationGas",
                (&op.user_op, op.entry_point),
            )
            .await
            .map_err(|e| BundlerError::Other(Box::new(e)))?)
    }

    async fn send_user_operation(
        &self,
        op: &SignedUserOperation,
    ) -> Result<UserOperationHash, BundlerError> {
        info!("Sending user operation to Pimlico...");
        let hash: B256 = self
            .client
            .request("eth_sendUserOperation", (&op.user_op, op.entry_point))
            .await
            .map_err(|e| BundlerError::Other(Box::new(e)))?;

        Ok(UserOperationHash(hash))
    }

    async fn wait_for_receipt(
        &self,
        hash: UserOperationHash,
    ) -> Result<UserOperationReceipt, BundlerError> {
        info!("Waiting for user operation receipt from Pimlico...");

        for _ in 0..5 {
            let receipt: Option<UserOperationReceipt> = self
                .client
                .request("eth_getUserOperationReceipt", (hash.0,))
                .await
                .map_err(|e| BundlerError::Other(Box::new(e)))?;

            if let Some(r) = receipt {
                return Ok(r);
            }

            info!("User operation not yet included, retrying...");
            common::sleep(common::Duration::from_secs(2)).await;
        }

        Err(BundlerError::Timeout)
    }
}

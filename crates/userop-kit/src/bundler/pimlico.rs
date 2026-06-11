use alloy::primitives::B256;
use reqwest::Url;
use serde::Deserialize;
use tracing::info;

use crate::{
    bundler::{
        bundler::{Bundler, BundlerError},
        rpc_client::RpcClient,
    },
    signable_user_operation::SignableUserOperation,
    signed_user_operation::SignedUserOperation,
    user_operation::{UserOperationGasEstimate, UserOperationHash, UserOperationReceipt},
};

/// A bundler provider for Pimlico.
pub struct PimlicoBundler {
    client: RpcClient,
    wait_interval: common::Duration,
    timeout: common::Duration,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PimlicoUserOperationGasEstimate {
    #[serde(with = "alloy::serde::quantity")]
    pub call_gas_limit: u128,
    #[serde(with = "alloy::serde::quantity")]
    pub verification_gas_limit: u128,
    #[serde(with = "alloy::serde::quantity")]
    pub pre_verification_gas: u128,
    #[serde(default, with = "alloy::serde::quantity::opt")]
    pub paymaster_post_op_gas_limit: Option<u128>,
    #[serde(default, with = "alloy::serde::quantity::opt")]
    pub paymaster_verification_gas_limit: Option<u128>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PimlicoUserOperationGasPrice {
    pub slow: PimlicoSpeedGasEstimate,
    #[allow(dead_code)]
    pub standard: PimlicoSpeedGasEstimate,
    #[allow(dead_code)]
    pub fast: PimlicoSpeedGasEstimate,
}

#[derive(Debug, Clone, Deserialize)]
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
            wait_interval: common::Duration::from_secs(6),
            timeout: common::Duration::from_secs(60),
        }
    }
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
impl Bundler for PimlicoBundler {
    async fn estimate_gas(
        &self,
        op: &SignableUserOperation,
    ) -> Result<UserOperationGasEstimate, BundlerError> {
        info!("Requesting gas estimate from Pimlico...");

        let (estimate, price): (
            PimlicoUserOperationGasEstimate,
            PimlicoUserOperationGasPrice,
        ) = futures::try_join!(
            self.client.request(
                "eth_estimateUserOperationGas",
                (&op.user_op, op.entry_point),
            ),
            self.client
                .request("pimlico_getUserOperationGasPrice", serde_json::json!([]))
        )
        .map_err(|e| BundlerError::Other(Box::new(e)))?;

        Ok(UserOperationGasEstimate {
            call_gas_limit: estimate.call_gas_limit,
            verification_gas_limit: estimate.verification_gas_limit,
            pre_verification_gas: estimate.pre_verification_gas,
            paymaster_post_op_gas_limit: estimate.paymaster_post_op_gas_limit,
            paymaster_verification_gas_limit: estimate.paymaster_verification_gas_limit,
            max_fee_per_gas: price.slow.max_fee_per_gas,
            max_priority_fee_per_gas: price.slow.max_priority_fee_per_gas,
        })
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

        let start = common::Instant::now();
        while start.elapsed() < self.timeout {
            let receipt: Option<UserOperationReceipt> = self
                .client
                .request("eth_getUserOperationReceipt", (hash.0,))
                .await
                .map_err(|e| BundlerError::Other(Box::new(e)))?;

            if let Some(r) = receipt {
                return Ok(r);
            }

            info!("User operation not yet included, retrying...");
            common::sleep(self.wait_interval).await;
        }

        Err(BundlerError::Timeout)
    }
}

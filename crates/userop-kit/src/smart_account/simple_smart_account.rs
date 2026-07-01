use std::sync::Arc;

use alloy::{
    primitives::{Address, Bytes, U256, address, aliases::U192, bytes},
    rpc::types::Authorization,
};
use alloy_sol_types::{Eip712Domain, SolCall};
use eip_1193_provider::provider::{Eip1193Caller, Eip1193Provider, IntoEip1193Provider};
use serde::{Deserialize, Serialize};

use crate::{
    abis::entry_point::EntryPoint,
    entry_point::{ENTRY_POINT_08, entry_point_08_domain},
    smart_account::{SmartAccount, SmartAccountError},
};

/// Creates a simple smart account.
///
/// Defaults to the v0.8 EntryPoint and the eth-infinitism Simple7702Account implementation at
/// `0xe6Cae83BdE06E4c305530e199D7217f42808555B`.
#[derive(Clone)]
pub struct SimpleSmartAccount {
    owner: Address,
    chain_id: u64,
    provider: Arc<dyn Eip1193Provider>,

    implementation: Address,
    entry_point: Address,
    domain: Eip712Domain,
    dummy_signature: Bytes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "camelCase")]
pub struct Call {
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub target: Address,
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub value: U256,
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub data: Bytes,
}

impl SimpleSmartAccount {
    pub fn new(owner: Address, chain_id: u64, provider: impl IntoEip1193Provider) -> Self {
        let implementation = address!("0xe6Cae83BdE06E4c305530e199D7217f42808555B");
        let entry_point = ENTRY_POINT_08;
        let domain = entry_point_08_domain(chain_id);
        let dummy_signature = bytes!(
            "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c"
        );

        Self {
            owner,
            chain_id,
            provider: provider.into_eip1193(),
            implementation,
            entry_point,
            domain,
            dummy_signature,
        }
    }
}

#[cfg_attr(native, async_trait::async_trait)]
#[cfg_attr(wasm, async_trait::async_trait(?Send))]
impl SmartAccount for SimpleSmartAccount {
    type Call = Vec<Call>;

    fn entry_point(&self) -> Address {
        self.entry_point
    }

    fn domain(&self) -> Eip712Domain {
        self.domain.clone()
    }

    fn address(&self) -> Address {
        self.owner
    }

    async fn nonce(&self) -> Result<U256, SmartAccountError> {
        let nonce = self
            .provider
            .sol_call(
                self.entry_point,
                EntryPoint::getNonceCall::new((self.owner, U192::from(0))),
            )
            .await?;
        Ok(nonce)
    }

    async fn authorization(&self) -> Result<Authorization, SmartAccountError> {
        let nonce = self.owner_nonce().await?;

        Ok(Authorization {
            chain_id: U256::from(self.chain_id),
            address: self.implementation,
            nonce,
        })
    }

    fn dummy_signature(&self) -> Bytes {
        self.dummy_signature.clone()
    }

    fn abi_encode_call(call_data: &Self::Call) -> Bytes {
        if call_data.is_empty() {
            // If no calls, return empty data to save gas.
            return Bytes::new();
        }

        let calls = call_data
            .iter()
            .map(|call| abi::BaseAccount::Call {
                target: call.target,
                value: call.value,
                data: call.data.clone(),
            })
            .collect();

        abi::BaseAccount::executeBatchCall::new((calls,))
            .abi_encode()
            .into()
    }
}

impl SimpleSmartAccount {
    /// Gets the nonce for the owner address
    async fn owner_nonce(&self) -> Result<u64, SmartAccountError> {
        let nonce = self.provider.transaction_count(self.owner, None).await?;
        Ok(nonce)
    }
}

mod abi {
    use alloy::sol;

    sol!(
        contract BaseAccount {
            struct Call {
                address target;
                uint256 value;
                bytes data;
            }

            function executeBatch(Call[] calldata calls) external;
        }

    );
}

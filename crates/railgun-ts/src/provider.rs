use std::str::FromStr;

use alloy::primitives::Address;
use eip_1193_provider::tx_data::TxData;
use railgun::{account::address::RailgunAddress, caip::AssetId, provider::RailgunProvider};
use serde::Serialize;
use tsify::Tsify;
use userop_kit::signable_user_operation::SignableUserOperation;
use userop_kit_ts::bundler::JsBundler;
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::{
    shield_builder::JsShieldBuilder, signer::JsRailgunSigner,
    transaction_builder::JsTransactionBuilder,
};

/// Interfaces with the RAILGUN protocol.
#[wasm_bindgen(js_name = "RailgunProvider")]
pub struct JsRailgunProvider {
    inner: RailgunProvider,
}

#[derive(Tsify, Serialize)]
#[tsify(into_wasm_abi)]
#[serde(transparent)]
pub struct Balances(Vec<(AssetId, u128)>);

impl JsRailgunProvider {
    pub fn new(inner: RailgunProvider) -> Self {
        Self { inner }
    }
}

#[wasm_bindgen(js_class = "RailgunProvider")]
impl JsRailgunProvider {
    /// Register a signer with the provider. The provider will index and track
    /// UTXOs for the associated address.
    pub async fn register(&mut self, account: &JsRailgunSigner) -> Result<(), JsError> {
        self.inner
            .register(account.inner())
            .await
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Syncs the provider to the latest block.
    pub async fn sync(&mut self) -> Result<(), JsError> {
        self.inner
            .sync()
            .await
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// Returns the balance for the given address.
    ///
    /// If POI is enabled, only returns the spendable balance according to the POI provider.
    pub async fn balance(&mut self, address: RailgunAddress) -> Balances {
        let balances = self.inner.balance(address.clone()).await;
        Balances(balances.into_iter().collect())
    }

    /// Helper to create a shield builder.
    pub fn shield(&self) -> JsShieldBuilder {
        JsShieldBuilder {
            inner: self.inner.shield(),
        }
    }

    /// Helper to create a transaction builder.
    pub fn transact(&self) -> JsTransactionBuilder {
        JsTransactionBuilder {
            inner: self.inner.transact(),
        }
    }

    /// Build a transaction builder into a proved, signable transaction.
    pub async fn build(&mut self, builder: JsTransactionBuilder) -> Result<TxData, JsError> {
        let mut rng = rand::rng();
        let proved_tx = self
            .inner
            .build(builder.inner, &mut rng)
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(proved_tx.tx_data)
    }

    /// Build a transaction builder into a broadcastable 7702 UserOperation.
    ///
    /// Constructs a UserOperation sent from the `sender` that executes the provided transaction,
    /// with an additional fee note transfer to cover the bundler fees. The `fee_payer` is the
    /// signer that will authorize the fee note transfer to the bundler's address for the estimated
    /// fee amount in `fee_token`.
    #[wasm_bindgen(js_name = "prepareUserOp")]
    pub async fn prepare_userop(
        &mut self,
        builder: JsTransactionBuilder,
        bundler: &JsBundler,
        #[wasm_bindgen(unchecked_param_type = "`0x${string}`")] sender: String,
        #[wasm_bindgen(js_name = "feePayer")] fee_payer: &JsRailgunSigner,
        #[wasm_bindgen(js_name = "feeToken", unchecked_param_type = "`0x${string}`")]
        fee_token: String,
    ) -> Result<SignableUserOperation, JsError> {
        let sender = Address::from_str(&sender).map_err(|e| JsError::new(&e.to_string()))?;
        let fee_token = Address::from_str(&fee_token).map_err(|e| JsError::new(&e.to_string()))?;
        let mut rng = rand::rng();

        let user_op = self
            .inner
            .prepare_userop(
                builder.inner.clone(),
                bundler.inner().as_ref(),
                sender,
                fee_payer.inner(),
                fee_token,
                &mut rng,
            )
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(user_op)
    }
}

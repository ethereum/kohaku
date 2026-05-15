use std::{str::FromStr, sync::Arc};

use alloy::primitives::Address;
use eip_1193_provider::{TxData, js::JsEip1193Provider};
// use prover::JsProverAdapter;
use railgun_rs::{
    RailgunProvider,
    caip::AssetId,
    chain_config::ChainConfig,
    circuit::{groth16_prover::Groth16Prover, remote_artifact_loader::RemoteArtifactLoader},
    railgun::address::RailgunAddress,
};
use serde::Serialize;
use tsify::Tsify;
use userop_kit::{UserOperation, bundler::js::JsBundler};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::{
    railgun_signer::JsRailgunSigner, shield_builder::JsShieldBuilder,
    transaction_builder::JsTransactionBuilder, txid_syncer::JsTxidSyncer,
    utxo_syncer::JsNoteSyncer,
};

#[wasm_bindgen(js_name = "RailgunProvider")]
pub struct JsRailgunProvider {
    inner: RailgunProvider<Groth16Prover<RemoteArtifactLoader>>,
}

#[derive(Tsify, Serialize)]
#[tsify(into_wasm_abi)]
#[serde(transparent)]
pub struct Balances(Vec<(AssetId, u128)>);

#[wasm_bindgen(js_class = "RailgunProvider")]
impl JsRailgunProvider {
    #[wasm_bindgen(constructor)]
    pub fn new(chain: ChainConfig, provider: JsEip1193Provider, utxo_syncer: JsNoteSyncer) -> Self {
        let prover = Groth16Prover::new(RemoteArtifactLoader::new(
            "https://github.com/Robert-MacWha/privacy-protocol-artifacts/raw/refs/heads/main/artifacts/",
        ));

        Self {
            inner: RailgunProvider::new(
                chain,
                Arc::new(provider),
                utxo_syncer.inner.clone(),
                prover,
            ),
        }
    }

    #[wasm_bindgen(js_name = "setPOI")]
    pub fn set_poi(&mut self, txid_syncer: JsTxidSyncer) {
        self.inner.set_poi(txid_syncer.inner.clone());
    }

    #[wasm_bindgen(js_name = "setBundler")]
    pub fn set_bundler(&mut self, bundler: &JsBundler) {
        self.inner.set_bundler(bundler.inner());
    }

    pub fn register(&mut self, account: &JsRailgunSigner, from_block: Option<u64>) {
        match from_block {
            Some(from_block) => self.inner.register_from(account.inner(), from_block),
            None => self.inner.register(account.inner()),
        }
    }

    pub async fn balance(&mut self, address: RailgunAddress) -> Balances {
        let balances = self.inner.balance(address.clone()).await;
        Balances(balances.into_iter().collect())
    }

    pub fn shield(&self) -> JsShieldBuilder {
        JsShieldBuilder {
            inner: self.inner.shield(),
        }
    }

    pub fn transact(&self) -> JsTransactionBuilder {
        JsTransactionBuilder {
            inner: self.inner.transact(),
        }
    }

    pub async fn build(&mut self, builder: JsTransactionBuilder) -> Result<TxData, JsError> {
        let mut rng = rand::rng();
        let proved_tx = self
            .inner
            .build(builder.inner, &mut rng)
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(proved_tx.tx_data)
    }

    #[wasm_bindgen(js_name = "prepareBroadcast")]
    pub async fn prepare_broadcast(
        &mut self,
        builder: JsTransactionBuilder,
        #[wasm_bindgen(unchecked_param_type = "`0x${string}`")] sender: String,
        #[wasm_bindgen(js_name = "feePayer")] fee_payer: &JsRailgunSigner,
        #[wasm_bindgen(js_name = "feeToken", unchecked_param_type = "`0x${string}`")]
        fee_token: String,
    ) -> Result<UserOperation, JsError> {
        let sender = Address::from_str(&sender).map_err(|e| JsError::new(&e.to_string()))?;
        let fee_token = Address::from_str(&fee_token).map_err(|e| JsError::new(&e.to_string()))?;
        let mut rng = rand::rng();

        let user_op = self
            .inner
            .prepare_broadcast(
                builder.inner.clone(),
                sender,
                fee_payer.inner(),
                fee_token,
                &mut rng,
            )
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(user_op)
    }

    pub async fn sync(&mut self, to: Option<u64>) -> Result<(), JsError> {
        let result = match to {
            Some(to) => self.inner.sync_to(to).await,
            None => self.inner.sync().await,
        };
        result.map_err(|e| JsError::new(&e.to_string()))
    }
}

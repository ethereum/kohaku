use std::sync::Arc;

use eth_rpc::{EthRpcClient, JsEthRpcAdapter, TxData};
use prover::JsProverAdapter;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    railgun::{RailgunProvider, RailgunProviderState, address::RailgunAddress},
    wasm::{
        JsShieldBuilder, JsSigner, JsSyncer, JsTransactionBuilder, balance::JsBalanceEntry,
        chain::try_get_chain,
    },
};

#[wasm_bindgen]
pub struct JsRailgunProvider {
    pub(crate) inner: RailgunProvider,
}

#[wasm_bindgen]
impl JsRailgunProvider {
    /// Creates a new provider. Infers the chain from the RPC provider.
    pub async fn new(
        provider: JsEthRpcAdapter,
        syncer: JsSyncer,
        prover: JsProverAdapter,
    ) -> Result<JsRailgunProvider, JsValue> {
        let provider: Arc<dyn EthRpcClient> = Arc::new(provider);
        let prover = Arc::new(prover);
        let chain_id = provider
            .get_chain_id()
            .await
            .map_err(|e| JsValue::from_str(&format!("Failed to get chain ID: {}", e)))?;
        let chain = try_get_chain(chain_id)?;

        Ok(RailgunProvider::new(chain, provider, syncer.inner(), prover).into())
    }

    #[wasm_bindgen(js_name = "setState")]
    pub fn set_state(&mut self, state: &[u8]) -> Result<(), JsValue> {
        let state: RailgunProviderState = serde_json::from_slice(state)
            .map_err(|e| JsValue::from_str(&format!("Serde error: {}", e)))?;

        self.inner.set_state(state)?;
        Ok(())
    }

    /// Returns the provider's state as a serialized state object. Used to save state for
    /// future restoration.
    ///
    /// State does NOT include registered accounts. Accounts must be re-registered
    /// each time a provider is created.
    pub fn state(&self) -> Result<Vec<u8>, JsValue> {
        let state = self.inner.state();
        serde_json::to_vec(&state).map_err(|e| JsValue::from_str(&format!("Serde error: {}", e)))
    }

    /// Register an account with the provider. The provider will index the account's
    /// transactions and balance as it syncs.
    ///
    /// Providers will NOT retroactively index transactions for an account.
    /// Providers will NOT save registered accounts in their state. Accounts
    /// must be re-registered each time a provider is created.
    pub fn register(&mut self, signer: &JsSigner) {
        self.inner.register(signer.inner());
    }

    /// Returns the raw balance for the given address
    pub fn balance(&mut self, address: RailgunAddress) -> Vec<JsBalanceEntry> {
        self.inner
            .balance(address)
            .into_iter()
            .map(|(asset_id, balance)| JsBalanceEntry { asset_id, balance })
            .collect()
    }

    /// Helper to create a shield builder
    pub fn shield(&self) -> JsShieldBuilder {
        self.inner.shield().into()
    }

    /// Helper to create a transaction builder
    pub fn transact(&self) -> JsTransactionBuilder {
        self.inner.transact().into()
    }

    /// Build a executable transaction from a transaction builder
    pub async fn build(&self, builder: JsTransactionBuilder) -> Result<TxData, JsValue> {
        let mut rng = rand::rng();
        let proved_tx = self.inner.build(builder.into(), &mut rng).await?;
        Ok(proved_tx.tx_data)
    }

    pub async fn sync(&mut self) -> Result<(), JsValue> {
        Ok(self.inner.sync().await?)
    }

    #[wasm_bindgen(js_name = "syncTo")]
    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), JsValue> {
        Ok(self.inner.sync_to(block_number).await?)
    }
}

impl From<RailgunProvider> for JsRailgunProvider {
    fn from(inner: RailgunProvider) -> Self {
        JsRailgunProvider { inner }
    }
}

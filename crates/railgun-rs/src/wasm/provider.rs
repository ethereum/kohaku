use std::sync::Arc;

use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    railgun::{RailgunProvider, RailgunProviderState, address::RailgunAddress},
    wasm::{
        JsProver, JsShieldBuilder, JsSigner, JsSyncer, JsTransactionBuilder, JsTxData,
        balance::JsBalance,
        chain::{new_dyn_provider, try_get_chain},
    },
};

#[wasm_bindgen]
pub struct JsRailgunProvider {
    pub(crate) inner: RailgunProvider,
}

#[wasm_bindgen]
impl JsRailgunProvider {
    /// Creates a new provider with the given args
    pub async fn new(
        chain_id: u64,
        rpc_url: &str,
        syncer: JsSyncer,
        prover: JsProver,
    ) -> Result<JsRailgunProvider, JsValue> {
        let chain = try_get_chain(chain_id)?;
        let provider = new_dyn_provider(rpc_url).await?;
        let prover: Arc<JsProver> = Arc::new(prover);

        Ok(RailgunProvider::new(chain, provider, syncer.inner(), prover).into())
    }

    /// Creates a new provider using the given args. Automatically creates a chained
    /// subsquid/RPC syncer with the given RPC URL and chain ID.
    pub async fn new_from_rpc(
        chain_id: u64,
        rpc_url: &str,
        batch_size: u64,
        prover: JsProver,
    ) -> Result<JsRailgunProvider, JsValue> {
        let subsquid_syncer = JsSyncer::new_subsquid(chain_id)?;
        let rpc_syncer = JsSyncer::new_rpc(rpc_url, chain_id, batch_size).await?;
        let syncer = JsSyncer::new_chained(vec![subsquid_syncer, rpc_syncer]);

        Self::new(chain_id, rpc_url, syncer, prover).await
    }

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
    pub fn balance(&mut self, address: RailgunAddress) -> Result<JsBalance, JsValue> {
        Ok(self.inner.balance(address).into())
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
    pub async fn build(&self, builder: JsTransactionBuilder) -> Result<JsTxData, JsValue> {
        let mut rng = rand::rng();
        let proved_tx = self.inner.build(builder.into(), &mut rng).await?;
        Ok(proved_tx.tx_data.into())
    }

    pub async fn sync(&mut self) -> Result<(), JsValue> {
        Ok(self.inner.sync().await?)
    }

    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), JsValue> {
        Ok(self.inner.sync_to(block_number).await?)
    }
}

impl From<RailgunProvider> for JsRailgunProvider {
    fn from(inner: RailgunProvider) -> Self {
        JsRailgunProvider { inner }
    }
}

use std::sync::Arc;

use wasm_bindgen::{JsError, JsValue, prelude::wasm_bindgen};

use crate::{
    railgun::{
        PoiProvider, PoiProviderState,
        address::RailgunAddress,
        broadcaster::broadcaster::Fee,
        indexer::SubsquidSyncer,
        poi::{ListKey, PoiClient},
    },
    wasm::{
        JsBroadcaster, JsFee, JsPoiProvedTx, JsPoiTransactionBuilder, JsProver, JsShieldBuilder,
        JsSigner, JsSyncer,
        chain::{new_dyn_provider, try_get_chain},
        poi_balance::JsPoiBalance,
    },
};

#[wasm_bindgen]
pub struct JsPoiProvider {
    pub(crate) inner: PoiProvider,
}

#[wasm_bindgen]
impl JsPoiProvider {
    /// Creates a new provider with the given args
    pub async fn new(
        chain_id: u64,
        rpc_url: &str,
        utxo_syncer: JsSyncer,
        prover: JsProver,
    ) -> Result<JsPoiProvider, JsValue> {
        let chain = try_get_chain(chain_id)?;
        let provider = new_dyn_provider(rpc_url).await?;

        let utxo_syncer = utxo_syncer.inner();
        let txid_syncer = Arc::new(SubsquidSyncer::new(chain.subsquid_endpoint));
        let prover = Arc::new(prover);

        let poi_client = PoiClient::new(chain.poi_endpoint, chain_id)
            .await
            .map_err(|e| JsError::new(&format!("Failed to create POI client: {}", e)))?;

        Ok(PoiProvider::new(
            chain,
            provider,
            utxo_syncer,
            prover.clone(),
            txid_syncer,
            poi_client,
            prover.clone(),
        )
        .into())
    }

    /// Creates a new provider using the given args. Automatically creates a chained
    /// subsquid/RPC syncer with the given RPC URL and chain ID.
    pub async fn new_from_rpc(
        chain_id: u64,
        rpc_url: &str,
        batch_size: u64,
        prover: JsProver,
    ) -> Result<JsPoiProvider, JsValue> {
        let subsquid_syncer = JsSyncer::new_subsquid(chain_id)?;
        let rpc_syncer = JsSyncer::new_rpc(rpc_url, chain_id, batch_size).await?;
        let syncer = JsSyncer::new_chained(vec![subsquid_syncer, rpc_syncer]);

        Self::new(chain_id, rpc_url, syncer, prover).await
    }

    /// Sets the provider's state from a serialized state object. Used to restore
    /// state from a previous session.
    pub fn set_state(&mut self, state: &[u8]) -> Result<(), JsValue> {
        let state: PoiProviderState = serde_json::from_slice(state)
            .map_err(|e| JsValue::from_str(&format!("Serde error: {}", e)))?;

        self.inner.set_state(state)?;
        Ok(())
    }

    /// Returns the provider's state as a serialized state object. Used to save state for
    /// future restoration.
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

    /// Returns the POI-annotated balance for the given address and list key.
    pub async fn balance(&mut self, address: RailgunAddress, list_key: ListKey) -> JsPoiBalance {
        self.inner.balance(address, &list_key).await.into()
    }

    /// Helper to create a shield builder
    pub fn shield(&self) -> JsShieldBuilder {
        self.inner.shield().into()
    }

    /// Helper to create a POI transaction builder
    pub fn transact(&self) -> JsPoiTransactionBuilder {
        self.inner.transact().into()
    }

    /// Build a transaction from a POI transaction builder and register it in
    /// the POI proving queue.
    pub async fn build(
        &mut self,
        builder: JsPoiTransactionBuilder,
    ) -> Result<JsPoiProvedTx, JsError> {
        let mut rng = rand::rng();
        let proved_tx = self
            .inner
            .build(builder.inner, &mut rng)
            .await
            .map_err(|e| JsError::new(&format!("Build error: {}", e)))?;

        Ok(proved_tx.into())
    }

    /// Build a broadcastable transaction from a POI transaction builder and
    /// register it in the POI proving queue.
    pub async fn build_broadcast(
        &mut self,
        builder: JsPoiTransactionBuilder,
        fee_payer: &JsSigner,
        fee: &JsFee,
    ) -> Result<JsPoiProvedTx, JsError> {
        let mut rng = rand::rng();
        let fee: Fee = fee.into();
        let proved_tx = self
            .inner
            .build_broadcast(builder.inner, fee_payer.inner(), &fee, &mut rng)
            .await
            .map_err(|e| JsError::new(&format!("Build/broadcast error: {}", e)))?;

        Ok(proved_tx.into())
    }

    /// Broadcast a proved transaction using the given broadcaster, awaiting confirmation
    /// via either the broadcaster's response or if the transaction's commitments
    /// are indexed on-chain.
    pub async fn broadcast(
        &mut self,
        broadcaster: &JsBroadcaster,
        proved_tx: &JsPoiProvedTx,
    ) -> Result<(), JsError> {
        self.inner
            .broadcast(&broadcaster.inner, &proved_tx.inner)
            .await
            .map_err(|e| JsError::new(&format!("Broadcast error: {}", e)))
    }

    pub async fn sync(&mut self) -> Result<(), JsValue> {
        Ok(self.inner.sync().await?)
    }

    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), JsValue> {
        Ok(self.inner.sync_to(block_number).await?)
    }

    pub fn list_keys(&self) -> Vec<String> {
        self.inner
            .list_keys()
            .into_iter()
            .map(|k| k.into())
            .collect()
    }

    pub fn reset_indexer(&mut self) {
        self.inner.reset_indexer();
    }
}

impl From<PoiProvider> for JsPoiProvider {
    fn from(inner: PoiProvider) -> Self {
        Self { inner }
    }
}

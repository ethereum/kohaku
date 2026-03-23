use std::sync::Arc;

use eth_rpc::{EthRpcClient, JsEthRpcAdapter};
use prover::JsProverAdapter;
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
        JsBroadcaster, JsPoiProvedTx, JsPoiTransactionBuilder, JsShieldBuilder, JsSigner,
        JsSyncer, chain::try_get_chain, poi_balance::JsPoiBalance,
    },
};

#[wasm_bindgen]
pub struct JsPoiProvider {
    pub(crate) inner: PoiProvider,
}

#[wasm_bindgen]
impl JsPoiProvider {
    /// Creates a new provider. Infers the chain from the RPC provider.
    pub async fn new(
        provider: JsEthRpcAdapter,
        utxo_syncer: JsSyncer,
        prover: JsProverAdapter,
    ) -> Result<JsPoiProvider, JsValue> {
        let utxo_syncer = utxo_syncer.inner();
        let provider: Arc<dyn EthRpcClient> = Arc::new(provider);
        let prover = Arc::new(prover);

        let chain_id = provider
            .get_chain_id()
            .await
            .map_err(|e| JsValue::from_str(&format!("Failed to get chain ID: {}", e)))?;
        let chain = try_get_chain(chain_id)?;

        let txid_syncer = Arc::new(SubsquidSyncer::new(chain.subsquid_endpoint));
        let poi_client = PoiClient::new(chain.poi_endpoint, chain_id)
            .await
            .map_err(|e| JsError::new(&format!("Failed to create POI client: {}", e)))?;

        Ok(PoiProvider::new(
            chain,
            provider,
            utxo_syncer,
            prover,
            txid_syncer,
            poi_client,
        )
        .into())
    }

    /// Sets the provider's state from a serialized state object. Used to restore
    /// state from a previous session.
    #[wasm_bindgen(js_name = "setState")]
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
    pub async fn balance(
        &mut self,
        address: RailgunAddress,
        list_key: ListKey,
    ) -> Vec<JsPoiBalance> {
        self.inner
            .balance(address, &list_key)
            .await
            .iter()
            .map(|(k, v)| JsPoiBalance {
                poi_status: k.0,
                asset_id: k.1.clone(),
                balance: *v,
            })
            .collect()
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
    #[wasm_bindgen(js_name = "buildBroadcast")]
    pub async fn build_broadcast(
        &mut self,
        builder: JsPoiTransactionBuilder,
        fee_payer: &JsSigner,
        fee: Fee,
    ) -> Result<JsPoiProvedTx, JsError> {
        let mut rng = rand::rng();
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

    #[wasm_bindgen(js_name = "syncTo")]
    pub async fn sync_to(&mut self, block_number: u64) -> Result<(), JsValue> {
        Ok(self.inner.sync_to(block_number).await?)
    }

    #[wasm_bindgen(js_name = "listKeys")]
    pub fn list_keys(&self) -> Vec<String> {
        self.inner
            .list_keys()
            .into_iter()
            .map(|k| k.into())
            .collect()
    }

    #[wasm_bindgen(js_name = "resetIndexer")]
    pub fn reset_indexer(&mut self) {
        self.inner.reset_indexer();
    }
}

impl From<PoiProvider> for JsPoiProvider {
    fn from(inner: PoiProvider) -> Self {
        Self { inner }
    }
}

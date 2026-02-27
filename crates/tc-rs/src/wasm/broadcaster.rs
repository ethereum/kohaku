use std::sync::Arc;

use alloy::primitives::Address;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    PoolProviderState,
    broadcaster::BroadcastProvider,
    wasm::{
        JsDepositResult, JsPool, JsProver, JsSyncer, JsVerifier, note::JsNote,
        prepared_broadcast::JsPreparedBroadcast, provider::bigint_to_u256,
        relayer_syncer::JsRelayerSyncer, syncer::new_dyn_provider,
    },
};

#[wasm_bindgen]
pub struct JsBroadcastProvider {
    inner: BroadcastProvider,
}

#[wasm_bindgen]
impl JsBroadcastProvider {
    /// Creates a new BroadcastProvider
    ///
    /// @param syncer Syncer used to index deposits/withdrawals
    /// @param verifier Verifier used for on-chain root verification
    /// @param prover Prover used to generate proofs
    /// @param relayer_syncer Syncer used to index relayers
    /// @param rpc_url RPC URL for ethereum mainnet (used for relayer syncing)
    pub async fn new(
        syncer: JsSyncer,
        verifier: JsVerifier,
        prover: JsProver,
        relayer_syncer: JsRelayerSyncer,
        mainnet_rpc_url: &str,
    ) -> Result<JsBroadcastProvider, JsValue> {
        let mainnet_provider = new_dyn_provider(mainnet_rpc_url).await?;

        let inner = BroadcastProvider::new(
            syncer.inner(),
            verifier.inner(),
            Arc::new(prover),
            relayer_syncer.inner(),
            mainnet_provider,
        );
        Ok(inner.into())
    }

    #[wasm_bindgen(js_name = "addPool")]
    pub fn add_pool(&mut self, pool: &JsPool) {
        self.inner.add_pool(pool.inner.clone());
    }

    #[wasm_bindgen(js_name = "addPoolFromState")]
    pub fn add_pool_from_state(&mut self, state: &[u8]) -> Result<(), JsValue> {
        let state: PoolProviderState = serde_json::from_slice(state)
            .map_err(|e| JsValue::from_str(&format!("Serde error: {}", e)))?;
        self.inner.add_pool_from_state(state);
        Ok(())
    }

    pub fn state(&self) -> Result<Vec<u8>, JsValue> {
        let state = self.inner.state();
        serde_json::to_vec(&state).map_err(|e| JsValue::from_str(&format!("Serde error: {}", e)))
    }

    pub fn deposit(&self, pool: &JsPool) -> Result<JsDepositResult, JsValue> {
        let mut rng = rand::rng();
        let (tx_data, note) = self.inner.deposit(&pool.inner, &mut rng)?;
        Ok(JsDepositResult {
            tx_data: tx_data.into(),
            note: note.into(),
        })
    }

    /// Prepares a withdrawal transaction for broadcasting
    ///
    /// @param pool The pool to withdraw from
    /// @param note The note to withdraw
    /// @param rpc_url RPC URL for the target network (used for gas estimation)
    /// @param recipient The address to receive the withdrawn funds
    /// @param refund Optional
    #[wasm_bindgen(js_name = "prepareBroadcast")]
    pub async fn prepare_broadcast(
        &self,
        pool: &JsPool,
        note: &JsNote,
        rpc_url: &str,
        recipient: String,
        refund: Option<js_sys::BigInt>,
    ) -> Result<JsPreparedBroadcast, JsValue> {
        let recipient: Address = recipient
            .parse()
            .map_err(|e| JsValue::from_str(&format!("Invalid recipient address: {}", e)))?;

        let refund = match refund {
            Some(r) => Some(bigint_to_u256(r)?),
            None => None,
        };

        let provider = new_dyn_provider(rpc_url).await?;

        let mut rng = rand::rng();
        let prepared = self
            .inner
            .prepare_broadcast(
                &pool.inner,
                &note.inner,
                &provider,
                recipient,
                refund,
                &mut rng,
            )
            .await?;
        Ok(prepared.into())
    }

    /// Broadcasts a prepared transaction
    ///
    /// @return The txhash for the broadcasted transaction (0x...)
    pub async fn broadcast(&self, prepared: JsPreparedBroadcast) -> Result<String, JsValue> {
        let tx_hash = self.inner.broadcast(prepared.inner).await?;
        Ok(tx_hash.to_string())
    }

    pub async fn sync(&mut self) -> Result<(), JsValue> {
        self.inner
            .sync()
            .await
            .map_err(|e| JsValue::from_str(&format!("Sync error: {}", e)))
    }
}

impl From<BroadcastProvider> for JsBroadcastProvider {
    fn from(inner: BroadcastProvider) -> Self {
        JsBroadcastProvider { inner }
    }
}

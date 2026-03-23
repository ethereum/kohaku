use std::sync::Arc;

use alloy_primitives::Address;
use eth_rpc::JsEthRpcAdapter;
use prover::JsProverAdapter;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    Pool,
    relayers::RelayerProvider,
    wasm::{
        JsDepositResult, JsPool, JsSyncer, note::JsNote, prepared_broadcast::JsPreparedTransaction,
        provider::bigint_to_u256,
    },
};

#[wasm_bindgen]
pub struct JsRelayerProvider {
    inner: RelayerProvider,
}

#[wasm_bindgen]
impl JsRelayerProvider {
    /// Creates a new RelayerProvider
    ///
    /// @param provider RPC provider for the pool's chain (syncing and root verification)
    /// @param syncer Syncer used to index deposits/withdrawals
    /// @param prover Prover used to generate proofs
    /// @param mainnet_provider RPC provider for ethereum mainnet (used for relayer syncing)
    pub async fn new(
        provider: JsEthRpcAdapter,
        syncer: JsSyncer,
        prover: JsProverAdapter,
        mainnet_provider: JsEthRpcAdapter,
    ) -> Result<JsRelayerProvider, JsValue> {
        let inner = RelayerProvider::new(
            Arc::new(provider),
            syncer.inner(),
            Arc::new(prover),
            Arc::new(mainnet_provider),
        );
        Ok(inner.into())
    }

    pub fn state(&self) -> Result<Vec<u8>, JsValue> {
        let state = self.inner.state();
        serde_json::to_vec(&state).map_err(|e| JsValue::from_str(&format!("Serde error: {}", e)))
    }

    pub fn deposit(&mut self, pool: &JsPool) -> Result<JsDepositResult, JsValue> {
        let mut rng = rand::rng();

        let pool = Pool::from_id(&pool.amount, pool.symbol(), pool.chain_id).ok_or_else(|| {
            JsValue::from_str(&format!(
                "Pool not found for chain_id {}, symbol {}, amount {}",
                pool.chain_id,
                pool.symbol(),
                pool.amount
            ))
        })?;

        let (tx_data, note) = self.inner.deposit(&pool, &mut rng);
        Ok(JsDepositResult {
            tx_data: tx_data.into(),
            note: note.into(),
        })
    }

    /// Prepares a withdrawal transaction for relaying
    ///
    /// @param note The note to withdraw
    /// @param provider RPC provider for the target network (used for gas estimation)
    /// @param recipient The address to receive the withdrawn funds
    /// @param refund Optional
    #[wasm_bindgen(js_name = "prepare")]
    pub async fn prepare(
        &mut self,
        note: &JsNote,
        provider: JsEthRpcAdapter,
        recipient: String,
        refund: Option<js_sys::BigInt>,
    ) -> Result<JsPreparedTransaction, JsValue> {
        let recipient: Address = recipient
            .parse()
            .map_err(|e| JsValue::from_str(&format!("Invalid recipient address: {}", e)))?;

        let refund = match refund {
            Some(r) => Some(bigint_to_u256(r)?),
            None => None,
        };

        let mut rng = rand::rng();
        let prepared = self
            .inner
            .prepare(&note.inner, &provider, recipient, refund, &mut rng)
            .await?;
        Ok(prepared.into())
    }

    /// Submits a prepared transaction
    ///
    /// @return The txhash for the relayed transaction (0x...)
    #[wasm_bindgen(unchecked_return_type = "`0x${string}`")]
    pub async fn submit(&self, prepared: JsPreparedTransaction) -> Result<String, JsValue> {
        let tx_hash = self.inner.submit(prepared.inner).await?;
        Ok(tx_hash.to_string())
    }

    pub async fn sync(&mut self) -> Result<(), JsValue> {
        self.inner
            .sync()
            .await
            .map_err(|e| JsValue::from_str(&format!("Sync error: {}", e)))
    }
}

impl From<RelayerProvider> for JsRelayerProvider {
    fn from(inner: RelayerProvider) -> Self {
        JsRelayerProvider { inner }
    }
}

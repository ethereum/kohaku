use std::sync::Arc;

use alloy_primitives::Address;
use eth_rpc::{JsEthRpcAdapter, TxData};
use prover::JsProverAdapter;
use rand::rng;
use wasm_bindgen::{JsValue, prelude::wasm_bindgen};

use crate::{
    Pool,
    provider::TornadoProvider,
    wasm::{JsPool, note::JsNote, syncer::JsSyncer},
};

#[wasm_bindgen]
pub struct JsTornadoProvider {
    inner: TornadoProvider,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct JsDepositResult {
    pub(crate) tx_data: TxData,
    pub(crate) note: JsNote,
}

#[wasm_bindgen]
impl JsDepositResult {
    #[wasm_bindgen(getter, js_name = "txData")]
    pub fn tx_data(&self) -> TxData {
        self.tx_data.clone()
    }

    #[wasm_bindgen(getter)]
    pub fn note(&self) -> JsNote {
        self.note.clone()
    }
}

#[wasm_bindgen]
impl JsTornadoProvider {
    /// Creates a new TornadoProvider
    ///
    /// @param provider RPC provider for on-chain interaction and root verification
    /// @param syncer Syncer used to index deposits/withdrawals
    /// @param prover Prover used to generate proofs
    pub fn new(
        provider: JsEthRpcAdapter,
        syncer: JsSyncer,
        prover: JsProverAdapter,
    ) -> JsTornadoProvider {
        let inner = TornadoProvider::new(Arc::new(provider), syncer.inner(), Arc::new(prover));
        inner.into()
    }

    pub fn state(&self) -> Result<Vec<u8>, JsValue> {
        let state = self.inner.state();
        serde_json::to_vec(&state).map_err(|e| JsValue::from_str(&format!("Serde error: {}", e)))
    }

    pub fn deposit(&mut self, pool: &JsPool) -> Result<JsDepositResult, JsValue> {
        let mut rng = rng();

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

    /// Creates a withdrawal transaction for the given note
    ///
    /// @param note The note to withdraw
    /// @param recipient The address to receive the withdrawn funds
    /// @param refund Optional
    ///
    /// @returns The transaction data for the withdrawal transaction, which can
    /// be signed and broadcast by the caller
    pub async fn withdraw(
        &mut self,
        note: &JsNote,
        recipient: String,
        refund: Option<js_sys::BigInt>,
    ) -> Result<TxData, JsValue> {
        let recipient: Address = recipient
            .parse()
            .map_err(|e| JsValue::from_str(&format!("Invalid recipient address: {}", e)))?;

        let refund = match refund {
            Some(r) => Some(bigint_to_u256(r)?),
            None => None,
        };

        let tx_data = self
            .inner
            .withdraw(&note.inner, recipient, None, None, refund)
            .await?;

        Ok(tx_data)
    }

    pub async fn sync(&mut self) -> Result<(), JsValue> {
        self.inner
            .sync()
            .await
            .map_err(|e| JsValue::from_str(&format!("Sync error: {}", e)))
    }

    #[wasm_bindgen(js_name = "syncTo")]
    pub async fn sync_to(&mut self, block: u64) -> Result<(), JsValue> {
        self.inner
            .sync_to(block)
            .await
            .map_err(|e| JsValue::from_str(&format!("Sync error: {}", e)))
    }
}

impl From<TornadoProvider> for JsTornadoProvider {
    fn from(inner: TornadoProvider) -> Self {
        Self { inner }
    }
}

pub fn bigint_to_u256(val: js_sys::BigInt) -> Result<ruint::aliases::U256, JsValue> {
    let s = val
        .to_string(10)
        .map_err(|e| JsValue::from_str(&format!("BigInt to string error: {:?}", e)))?
        .as_string()
        .ok_or_else(|| JsValue::from_str("BigInt to string returned non-string"))?;
    ruint::aliases::U256::from_str_radix(&s, 10)
        .map_err(|e| JsValue::from_str(&format!("U256 parse error: {}", e)))
}

use std::sync::Arc;

use eip_1193_provider::js::JsEip1193Provider;
use railgun_rs::{builder::RailgunBuilder, chain_config::ChainConfig};
use wasm_bindgen::{JsError, prelude::wasm_bindgen};

use crate::{database::JsDatabase, provider::JsRailgunProvider, utxo_syncer::JsUtxoSyncer};

/// Builder for constructing a `RailgunProvider`.
#[wasm_bindgen(js_name = "RailgunBuilder")]
pub struct JsRailgunBuilder {
    inner: RailgunBuilder,
}

#[wasm_bindgen(js_class = "RailgunBuilder")]
impl JsRailgunBuilder {
    #[wasm_bindgen(constructor)]
    pub fn new(chain: ChainConfig, provider: JsEip1193Provider) -> Self {
        Self {
            inner: RailgunBuilder::new(chain, Arc::new(provider)),
        }
    }

    /// Sets a custom UTXO syncer for the provider. If not set, a default subsquid + RPC syncer will
    /// be used.
    #[wasm_bindgen(js_name = "withUtxoSyncer")]
    pub fn with_utxo_syncer(mut self, syncer: &JsUtxoSyncer) -> Self {
        self.inner = self.inner.with_utxo_syncer(syncer.inner());
        self
    }

    /// Sets a custom database for the provider. If not set, an in-memory database
    /// will be used.
    ///
    /// Providers will use the database for storing synced UTXO data, POI proofs, and other internal
    /// state. Sensitive data such as a user's unencrypted notes will be stored. Private key
    /// material will never be stored in the database.
    #[wasm_bindgen(js_name = "withDatabase")]
    pub fn with_database(mut self, database: JsDatabase) -> Self {
        self.inner = self.inner.with_database(Arc::new(database));
        self
    }

    /// Enables POI (Proof of innocence) support for the provider.
    ///
    /// Uses the default chain-specific POI endpoints and list keys from the chain config. Enabling
    /// this tells the builder to submit POI proofs when spending notes and to only spend
    /// notes that have been marked as `spendable` by the POI provider.
    #[wasm_bindgen(js_name = "withPoi")]
    pub fn with_poi(mut self) -> Self {
        self.inner = self.inner.with_poi();
        self
    }

    /// Builds the `RailgunProvider` with the specified configuration.
    pub async fn build(self) -> Result<JsRailgunProvider, JsError> {
        let inner = self
            .inner
            .build()
            .await
            .map_err(|e| JsError::new(&e.to_string()))?;

        Ok(JsRailgunProvider::new(inner))
    }
}

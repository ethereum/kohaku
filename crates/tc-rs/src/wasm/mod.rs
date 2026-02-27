mod error;
mod note;
mod pool;
mod prover;
mod provider;
mod syncer;
mod tx_data;
mod verifier;

pub use pool::JsPool;
pub use prover::JsProver;
pub use provider::{JsDepositResult, JsTornadoProvider};
pub use syncer::JsSyncer;
pub use tx_data::JsTxData;
pub use verifier::JsVerifier;
use wasm_bindgen::prelude::wasm_bindgen;

#[cfg(feature = "broadcaster")]
mod broadcaster;
#[cfg(feature = "broadcaster")]
mod prepared_broadcast;
#[cfg(feature = "broadcaster")]
mod relayer_syncer;

#[cfg(feature = "broadcaster")]
pub use broadcaster::JsBroadcastProvider;
#[cfg(feature = "broadcaster")]
pub use relayer_syncer::JsRelayerSyncer;

#[wasm_bindgen(start)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
    tracing_wasm::set_as_global_default_with_config(
        tracing_wasm::WASMLayerConfigBuilder::new()
            .set_max_level(tracing::Level::INFO)
            .build(),
    );
}

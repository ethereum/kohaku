mod error;
mod note;
mod pool;
mod provider;
mod syncer;

pub use pool::JsPool;
pub use provider::{JsDepositResult, JsTornadoProvider};
pub use syncer::JsSyncer;
use wasm_bindgen::prelude::wasm_bindgen;

#[cfg(feature = "relay")]
mod prepared_broadcast;
#[cfg(feature = "relay")]
mod relayer;

#[cfg(feature = "relay")]
pub use relayer::JsRelayerProvider;

#[wasm_bindgen(start)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
    tracing_wasm::set_as_global_default_with_config(
        tracing_wasm::WASMLayerConfigBuilder::new()
            .set_max_level(tracing::Level::INFO)
            .build(),
    );
}

mod balance;
mod caip;
mod chain;
mod error;
mod indexer;
mod poi_balance;
mod provider;
mod signer;
mod transaction;

pub use caip::{erc20, erc1155, erc721};
pub use indexer::JsSyncer;
pub use provider::JsRailgunProvider;
pub use signer::JsSigner;
pub use transaction::{
    JsPoiProvedTx, JsPoiTransactionBuilder, JsShieldBuilder, JsTransactionBuilder,
};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::wasm_bindgen;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, tsify::Tsify)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

impl From<LogLevel> for tracing::Level {
    fn from(level: LogLevel) -> Self {
        match level {
            LogLevel::Trace => tracing::Level::TRACE,
            LogLevel::Debug => tracing::Level::DEBUG,
            LogLevel::Info => tracing::Level::INFO,
            LogLevel::Warn => tracing::Level::WARN,
            LogLevel::Error => tracing::Level::ERROR,
        }
    }
}

#[cfg(feature = "poi")]
mod broadcaster;
#[cfg(feature = "poi")]
mod poi_provider;

#[cfg(feature = "poi")]
pub use broadcaster::{JsBroadcaster, JsBroadcasterManager, JsWakuAdapter};
#[cfg(feature = "poi")]
pub use poi_provider::JsPoiProvider;

#[wasm_bindgen(start, skip_typescript)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
}

/// Initialize console logging. Call once at startup to route tracing events
/// to the browser console. Defaults to `Info` if omitted.
#[wasm_bindgen(js_name = "initLogging")]
pub fn init_logging(max_level: Option<LogLevel>) {
    let level: tracing::Level = max_level.unwrap_or(LogLevel::Info).into();
    tracing_wasm::set_as_global_default_with_config(
        tracing_wasm::WASMLayerConfigBuilder::new()
            .set_max_level(level)
            .build(),
    );
}

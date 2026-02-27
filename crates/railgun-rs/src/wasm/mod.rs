mod balance;
mod caip;
mod chain;
mod error;
mod indexer;
mod poi_balance;
mod prover;
mod provider;
mod signer;
mod transaction;

pub use caip::erc20;
pub use indexer::JsSyncer;
pub use prover::JsProver;
pub use provider::JsRailgunProvider;
pub use signer::JsSigner;
pub use transaction::{
    JsPoiProvedTx, JsPoiTransactionBuilder, JsShieldBuilder, JsTransactionBuilder, JsTxData,
};
use wasm_bindgen::prelude::wasm_bindgen;

#[cfg(feature = "poi")]
mod broadcaster;
#[cfg(feature = "poi")]
mod poi_provider;

#[cfg(feature = "poi")]
pub use broadcaster::{JsBroadcaster, JsBroadcasterManager, JsFee, JsWakuAdapter};
#[cfg(feature = "poi")]
pub use poi_provider::JsPoiProvider;

#[wasm_bindgen(start)]
pub fn wasm_start() {
    console_error_panic_hook::set_once();
    tracing_wasm::set_as_global_default_with_config(
        tracing_wasm::WASMLayerConfigBuilder::new()
            .set_max_level(tracing::Level::INFO)
            .build(),
    );
}

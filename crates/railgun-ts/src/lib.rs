#![cfg(target_arch = "wasm32")]

pub mod builder;
pub mod caip;
pub mod chain_config;
pub mod database;
pub mod log;
pub mod provider;
pub mod shield_builder;
pub mod signer;
pub mod transaction_builder;
pub mod utxo_syncer;

#[wasm_bindgen::prelude::wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
}

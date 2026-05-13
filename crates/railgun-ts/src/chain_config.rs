use railgun_rs::chain_config::ChainConfig;
use wasm_bindgen::prelude::wasm_bindgen;

/// Gets the ChainConfig for Ethereum Mainnet.
#[wasm_bindgen(js_name = "chainConfigMainnet")]
pub fn chain_config_mainnet() -> ChainConfig {
    ChainConfig::mainnet()
}

/// Gets the ChainConfig for Sepolia Testnet.
#[wasm_bindgen(js_name = "chainConfigSepolia")]
pub fn chain_config_sepolia() -> ChainConfig {
    ChainConfig::sepolia()
}

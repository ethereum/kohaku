use railgun_rs::chain_config::ChainConfig;
use wasm_bindgen::prelude::wasm_bindgen;

/// Gets the ChainConfig for a given chain ID. Returns null if the chain ID is
/// not supported.
#[wasm_bindgen(js_name = "chainConfig")]
pub fn chain_config(chain_id: u32) -> Option<ChainConfig> {
    ChainConfig::from_chain_id(chain_id as u64)
}

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

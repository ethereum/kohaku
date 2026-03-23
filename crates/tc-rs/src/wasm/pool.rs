use alloy_primitives::Address;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::{
    Asset, ETHEREUM_ETHER_01, ETHEREUM_ETHER_1, ETHEREUM_ETHER_10, ETHEREUM_ETHER_100, POOLS, Pool,
    SEPOLIA_ETHER_01, SEPOLIA_ETHER_1, SEPOLIA_ETHER_10,
};

#[derive(Serialize, Deserialize, tsify::Tsify)]
#[serde(tag = "type")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum JsAsset {
    Native {
        symbol: String,
        decimals: u8,
    },
    Erc20 {
        #[tsify(type = "`0x${string}`")]
        address: Address,
        symbol: String,
        decimals: u8,
    },
}

#[derive(Serialize, Deserialize, tsify::Tsify)]
#[serde(rename_all = "camelCase")]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub struct JsPool {
    pub chain_id: u64,
    #[tsify(type = "`0x${string}`")]
    pub address: Address,
    pub asset: JsAsset,
    pub amount: String,
    #[tsify(type = "bigint")]
    pub amount_wei: u128,
}

#[wasm_bindgen]
pub fn pools() -> Vec<JsPool> {
    POOLS.iter().cloned().map(JsPool::from).collect()
}

#[wasm_bindgen(js_name = "ethereumEther01")]
pub fn ethereum_ether_01() -> JsPool {
    JsPool::from(ETHEREUM_ETHER_01)
}

#[wasm_bindgen(js_name = "ethereumEther1")]
pub fn ethereum_ether_1() -> JsPool {
    JsPool::from(ETHEREUM_ETHER_1)
}

#[wasm_bindgen(js_name = "ethereumEther10")]
pub fn ethereum_ether_10() -> JsPool {
    JsPool::from(ETHEREUM_ETHER_10)
}

#[wasm_bindgen(js_name = "ethereumEther100")]
pub fn ethereum_ether_100() -> JsPool {
    JsPool::from(ETHEREUM_ETHER_100)
}

#[wasm_bindgen(js_name = "sepoliaEther01")]
pub fn sepolia_ether_01() -> JsPool {
    JsPool::from(SEPOLIA_ETHER_01)
}

#[wasm_bindgen(js_name = "sepoliaEther1")]
pub fn sepolia_ether_1() -> JsPool {
    JsPool::from(SEPOLIA_ETHER_1)
}

#[wasm_bindgen(js_name = "sepoliaEther10")]
pub fn sepolia_ether_10() -> JsPool {
    JsPool::from(SEPOLIA_ETHER_10)
}

impl JsPool {
    pub fn symbol(&self) -> &str {
        match &self.asset {
            JsAsset::Native { symbol, .. } => symbol,
            JsAsset::Erc20 { symbol, .. } => symbol,
        }
    }
}

impl From<Pool> for JsPool {
    fn from(value: Pool) -> Self {
        Self {
            chain_id: value.chain_id,
            address: value.address,
            amount: value.amount(),
            asset: value.asset.into(),
            amount_wei: value.amount_wei,
        }
    }
}

impl From<Asset> for JsAsset {
    fn from(value: Asset) -> Self {
        match value {
            Asset::Native { symbol, decimals } => Self::Native {
                symbol: symbol.to_string(),
                decimals,
            },
            Asset::Erc20 {
                address,
                symbol,
                decimals,
            } => Self::Erc20 {
                address,
                symbol: symbol.to_string(),
                decimals,
            },
        }
    }
}

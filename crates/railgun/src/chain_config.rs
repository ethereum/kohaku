use alloy::primitives::{Address, ChainId, address};
use serde::{Deserialize, Serialize};

use crate::poi::types::ListKey;

/// Chain Configurations
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(into_wasm_abi, from_wasm_abi))]
#[serde(rename_all = "camelCase")]
pub struct ChainConfig {
    /// EIP-155 Chain ID
    #[cfg_attr(js, tsify(type = "number"))]
    pub id: ChainId,
    /// Railgun Smart Wallet Address on this chain
    ///
    /// Sourced from
    /// <https://docs.railgun.org/wiki/learn/helpful-links>
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub railgun_smart_wallet: Address,
    /// RelayAdapt contract for native base-token shielding (wrap + shield via `multicall`)
    ///
    /// Sourced from
    /// <https://github.com/Railgun-Community/shared-models/blob/main/src/models/network-config.ts>
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub relay_adapt_contract: Address,
    /// Wrapped base token (e.g. WETH on Ethereum) used in shield note preimages when shielding
    /// native ETH
    #[cfg_attr(js, tsify(type = "`0x${string}`"))]
    pub wrapped_base_token: Address,
    /// Block number the railgun smart wallet was deployed at
    pub deployment_block: u64,
    /// Block number when POI was launched for this chain
    ///
    /// Sourced from
    /// <https://github.com/Railgun-Community/shared-models/blob/dc3af7873305938f9f0771a24ad91f807f1b88e0/src/models/network-config.ts#L340>
    pub poi_start_block: u64,
    /// Subsquid GraphQL Endpoint for fast syncing
    ///
    /// Sourced from
    /// <https://github.com/Railgun-Community/wallet/blob/3ee3364648d416aa055bb1d5f5a2c4961be00ed6/src/services/railgun/railgun-txids/graphql/index.ts#L3187>
    pub subsquid_endpoint: String,

    /// Optional POI endpoint for this chain.
    ///
    /// Originally sourced from the RAILGUN docs. It's since disappeared from
    /// the docs, but the current value seems to be valid so ¯\_(ツ)_/¯
    ///
    /// Railgun's POI is confusing
    pub poi_endpoint: String,
    /// Optional list keys for POI
    pub list_keys: Vec<ListKey>,
}

impl ChainConfig {
    pub fn new(
        id: ChainId,
        railgun_smart_wallet: Address,
        relay_adapt_contract: Address,
        wrapped_base_token: Address,
        deployment_block: u64,
        poi_start_block: u64,
        subsquid_endpoint: impl Into<String>,
        poi_endpoint: impl Into<String>,
        list_keys: impl IntoIterator<Item: AsRef<str>>,
    ) -> Self {
        Self {
            id,
            railgun_smart_wallet,
            relay_adapt_contract,
            wrapped_base_token,
            deployment_block,
            poi_start_block,
            subsquid_endpoint: subsquid_endpoint.into(),
            poi_endpoint: poi_endpoint.into(),
            list_keys: list_keys.into_iter().map(|s| s.as_ref().into()).collect(),
        }
    }

    pub fn from_chain_id(chain_id: ChainId) -> Option<Self> {
        match chain_id {
            c if c == Self::mainnet().id => Some(Self::mainnet()),
            c if c == Self::sepolia().id => Some(Self::sepolia()),
            _ => None,
        }
    }

    pub fn mainnet() -> Self {
        Self::new(
            1,
            address!("0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9"),
            address!("0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a"),
            address!("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
            14693013,
            18514200,
            "https://rail-squid.squids.live/squid-railgun-ethereum-v2/v/v1/graphql",
            "https://ppoi-agg.horsewithsixlegs.xyz/",
            &["efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88"],
        )
    }

    pub fn sepolia() -> Self {
        Self::new(
            11155111,
            address!("0xeCFCf3b4eC647c4Ca6D49108b311b7a7C9543fea"),
            address!("0x7e3d929EbD5bDC84d02Bd3205c777578f33A214D"),
            address!("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"),
            5784774,
            5944700,
            "https://rail-squid.squids.live/squid-railgun-eth-sepolia-v2/v/v1/graphql",
            "https://ppoi-agg.horsewithsixlegs.xyz/",
            &["efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88"],
        )
    }
}

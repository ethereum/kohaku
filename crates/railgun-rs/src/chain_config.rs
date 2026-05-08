use alloy::primitives::{Address, ChainId, address};

use crate::railgun::poi::ListKey;

/// Eip155 Chain Configurations
#[derive(Copy, Clone, Debug)]
pub struct ChainConfig {
    /// EIP-155 Chain ID
    pub id: ChainId,
    /// Railgun Smart Wallet Address on this chain
    ///
    /// Sourced from
    /// https://docs.railgun.org/wiki/learn/helpful-links
    pub railgun_smart_wallet: Address,
    /// RelayAdapt contract for native base-token shielding (wrap + shield via `multicall`)
    ///
    /// Sourced from
    /// https://github.com/Railgun-Community/shared-models/blob/main/src/models/network-config.ts
    pub relay_adapt_contract: Address,
    /// Wrapped base token (e.g. WETH on Ethereum) used in shield note preimages when shielding
    /// native ETH
    pub wrapped_base_token: Address,
    /// Block number the railgun smart wallet was deployed at
    pub deployment_block: u64,
    /// Block number when POI was launched for this chain
    ///
    /// Sourced from
    /// https://github.com/Railgun-Community/shared-models/blob/dc3af7873305938f9f0771a24ad91f807f1b88e0/src/models/network-config.ts#L340
    pub poi_start_block: u64,
    /// Subsquid GraphQL Endpoint for fast syncing
    ///
    /// Sourced from
    /// https://github.com/Railgun-Community/wallet/blob/3ee3364648d416aa055bb1d5f5a2c4961be00ed6/src/services/railgun/railgun-txids/graphql/index.ts#L3187
    pub subsquid_endpoint: &'static str,

    /// Optional POI endpoint for this chain.
    ///
    /// Originally sourced from the RAILGUN docs. It's since disappeared from
    /// the docs, but the current value seems to be valid so ¯\_(ツ)_/¯
    ///
    /// Railgun's POI is confusing
    pub poi_endpoint: &'static str,
    /// Optional list keys for POI
    pub list_keys: &'static [&'static str],
}

pub const CHAIN_CONFIGS: &[ChainConfig] = &[MAINNET_CONFIG, SEPOLIA_CONFIG];

pub const MAINNET_CONFIG: ChainConfig = ChainConfig {
    id: 1,
    railgun_smart_wallet: address!("0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9"),
    relay_adapt_contract: address!("0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a"),
    wrapped_base_token: address!("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
    deployment_block: 14693013,
    poi_start_block: 18514200,
    subsquid_endpoint: "https://rail-squid.squids.live/squid-railgun-ethereum-v2/v/v1/graphql",
    poi_endpoint: "https://ppoi-agg.horsewithsixlegs.xyz/",
    list_keys: &["efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88"],
};

pub const SEPOLIA_CONFIG: ChainConfig = ChainConfig {
    id: 11155111,
    railgun_smart_wallet: address!("0xeCFCf3b4eC647c4Ca6D49108b311b7a7C9543fea"),
    relay_adapt_contract: address!("0x7e3d929EbD5bDC84d02Bd3205c777578f33A214D"),
    wrapped_base_token: address!("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"),
    deployment_block: 5784774,
    poi_start_block: 5944700,
    subsquid_endpoint: "https://rail-squid.squids.live/squid-railgun-eth-sepolia-v2/v/v1/graphql",
    poi_endpoint: "https://ppoi-agg.horsewithsixlegs.xyz/",
    list_keys: &["efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88"],
};

pub const fn get_chain_config(chain_id: ChainId) -> Option<ChainConfig> {
    //? Need to use a while loop since `get_chain_config` is a const fn
    let mut i = 0;
    while i < CHAIN_CONFIGS.len() {
        if CHAIN_CONFIGS[i].id == chain_id {
            return Some(CHAIN_CONFIGS[i]);
        }
        i += 1;
    }
    None
}

impl ChainConfig {
    pub fn list_keys(&self) -> Vec<ListKey> {
        self.list_keys.iter().map(|s| s.parse().unwrap()).collect()
    }
}

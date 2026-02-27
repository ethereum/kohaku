use alloy::primitives::{Address, ChainId, address};

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

    /// Optional POI endpoint for this chain,
    pub poi_endpoint: &'static str,
}

pub const CHAIN_CONFIGS: &[ChainConfig] = &[MAINNET_CONFIG, SEPOLIA_CONFIG];

pub const MAINNET_CONFIG: ChainConfig = ChainConfig {
    id: 1,
    railgun_smart_wallet: address!("0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9"),
    deployment_block: 14693013,
    poi_start_block: 18514200,
    subsquid_endpoint: "https://rail-squid.squids.live/squid-railgun-ethereum-v2/v/v1/graphql",
    poi_endpoint: "https://ppoi-agg.horsewithsixlegs.xyz/",
};

pub const SEPOLIA_CONFIG: ChainConfig = ChainConfig {
    id: 11155111,
    railgun_smart_wallet: address!("0xeCFCf3b4eC647c4Ca6D49108b311b7a7C9543fea"),
    deployment_block: 5784774,
    poi_start_block: 5944700,
    subsquid_endpoint: "https://rail-squid.squids.live/squid-railgun-eth-sepolia-v2/v/v1/graphql",
    poi_endpoint: "https://ppoi-agg.horsewithsixlegs.xyz/",
};

pub const fn get_chain_config(chain_id: ChainId) -> Option<ChainConfig> {
    let mut i = 0;
    while i < CHAIN_CONFIGS.len() {
        if CHAIN_CONFIGS[i].id == chain_id {
            return Some(CHAIN_CONFIGS[i]);
        }
        i += 1;
    }
    None
}

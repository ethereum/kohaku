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
    /// Unshield fee in basis points (bps).
    pub unshield_fee_bps: u16,
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
    /// Sourced from signal chat with the railgun team. Not publicly documented anywhere as far as
    /// I can tell, but the POI endpoint is required for any POI-related functionality.
    /// ¯\_(ツ)_/¯
    pub poi_endpoint: String,
    /// Optional list keys for POI
    pub list_keys: Vec<ListKey>,

    /// Privacy Paymaster address for this chain. This is used as the paymaster for all
    /// UserOperations.
    pub privacy_paymaster: Option<Address>,

    /// Railgun Fee Adapter address for this chain.
    pub railgun_fee_adapter: Option<Address>,
}

impl ChainConfig {
    pub fn new(
        id: ChainId,
        railgun_smart_wallet: Address,
        unshield_fee_bps: u16,
        relay_adapt_contract: Address,
        wrapped_base_token: Address,
        deployment_block: u64,
        poi_start_block: u64,
        subsquid_endpoint: impl Into<String>,
        poi_endpoint: impl Into<String>,
        list_keys: impl IntoIterator<Item: AsRef<str>>,
        privacy_paymaster: Option<Address>,
        railgun_fee_adapter: Option<Address>,
    ) -> Self {
        Self {
            id,
            railgun_smart_wallet,
            unshield_fee_bps,
            relay_adapt_contract,
            wrapped_base_token,
            deployment_block,
            poi_start_block,
            subsquid_endpoint: subsquid_endpoint.into(),
            poi_endpoint: poi_endpoint.into(),
            list_keys: list_keys.into_iter().map(|s| s.as_ref().into()).collect(),
            privacy_paymaster,
            railgun_fee_adapter,
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
            25,
            address!("0xAc9f360Ae85469B27aEDdEaFC579Ef2d052aD405"),
            address!("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"),
            14693013,
            18514200,
            "https://rail-squid.squids.live/squid-railgun-ethereum-v2/v/v1/graphql",
            "https://ppoi.fdi.network/",
            &["efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88"],
            Some(address!("0xE80e020Ca04150F9231788F375781445390D955D")),
            Some(address!("0x93066BC5d841c3eC874B79e7bDc9Fc83ff52E733")),
        )
    }

    pub fn sepolia() -> Self {
        Self::new(
            11155111,
            address!("0xeCFCf3b4eC647c4Ca6D49108b311b7a7C9543fea"),
            25,
            address!("0x7e3d929EbD5bDC84d02Bd3205c777578f33A214D"),
            address!("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"),
            5784774,
            5944700,
            "https://rail-squid.squids.live/squid-railgun-eth-sepolia-v2/v/v1/graphql",
            "https://ppoi.fdi.network/",
            &["efc6ddb59c098a13fb2b618fdae94c1c3a807abc8fb1837c93620c9143ee9e88"],
            Some(address!("0xBb9D6507B5dE027dEb0196c83A7DC6Eef325bEe4")),
            Some(address!("0xeBabF510f824a349a9Be7F40cad3486B7249b1e0")),
        )
    }
}

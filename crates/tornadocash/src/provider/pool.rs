use std::fmt::Display;

use alloy::primitives::{Address, address};
use serde::{Deserialize, Serialize};

use crate::provider::note::Note;

#[derive(Debug, Copy, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Asset {
    Native {
        symbol: &'static str,
        decimals: u8,
    },
    Erc20 {
        address: Address,
        symbol: &'static str,
        decimals: u8,
    },
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, Hash)]
pub struct Pool {
    pub chain_id: u64,
    pub address: Address,
    pub asset: Asset,
    pub amount_wei: u128,
    pub deployed_block: u64,
    pub paymaster_address: Option<Address>,
    pub adapter_address: Option<Address>,
}

pub const POOLS: &[Pool] = &[
    Pool::SEPOLIA_ETHER_01,
    Pool::SEPOLIA_ETHER_1,
    Pool::SEPOLIA_ETHER_10,
    Pool::ETHEREUM_ETHER_01,
    Pool::ETHEREUM_ETHER_1,
    Pool::ETHEREUM_ETHER_10,
    Pool::ETHEREUM_ETHER_100,
    Pool::POLYGON_MATIC_100,
    Pool::POLYGON_MATIC_1000,
];

#[allow(clippy::unreadable_literal)]
impl Pool {
    pub const SEPOLIA_ETHER_01: Pool = Pool {
        chain_id: 11155111,
        address: address!("0x8C4A04d872a6C1BE37964A21ba3a138525dFF50b"),
        asset: Asset::Native {
            symbol: "ETH",
            decimals: 18,
        },
        amount_wei: 10_u128.pow(17),
        deployed_block: 5_594_400,
        paymaster_address: Some(address!("0x1c5aCCb9c09D72945b79EC986776136bE01d7B2F")),
        adapter_address: Some(address!("0xa616aAE443FCCABfc2F1EA2Afe001E5046FFDCe0")),
    };

    pub const SEPOLIA_ETHER_1: Pool = Pool {
        chain_id: 11155111,
        address: address!("0x8cc930096B4Df705A007c4A039BDFA1320Ed2508"),
        asset: Asset::Native {
            symbol: "ETH",
            decimals: 18,
        },
        amount_wei: 10_u128.pow(18),
        deployed_block: 5_594_401,
        paymaster_address: Some(address!("0x1c5aCCb9c09D72945b79EC986776136bE01d7B2F")),
        adapter_address: Some(address!("0x67a898343F32641206d0f30CB3367944a8919A3A")),
    };

    pub const SEPOLIA_ETHER_10: Pool = Pool {
        chain_id: 11155111,
        address: address!("0x8D10d506D29Fc62ABb8A290B99F66dB27Fc43585"),
        asset: Asset::Native {
            symbol: "ETH",
            decimals: 18,
        },
        amount_wei: 10_u128.pow(19),
        deployed_block: 5_594_402,
        paymaster_address: None,
        adapter_address: None,
    };

    pub const ETHEREUM_ETHER_01: Pool = Pool {
        chain_id: 1,
        address: address!("0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc"),
        asset: Asset::Native {
            symbol: "ETH",
            decimals: 18,
        },
        amount_wei: 10_u128.pow(17),
        deployed_block: 9116966,
        paymaster_address: None,
        adapter_address: None,
    };

    pub const ETHEREUM_ETHER_1: Pool = Pool {
        chain_id: 1,
        address: address!("0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936"),
        asset: Asset::Native {
            symbol: "ETH",
            decimals: 18,
        },
        amount_wei: 10_u128.pow(18),
        deployed_block: 9_117_609,
        paymaster_address: None,
        adapter_address: None,
    };

    pub const ETHEREUM_ETHER_10: Pool = Pool {
        chain_id: 1,
        address: address!("0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF"),
        asset: Asset::Native {
            symbol: "ETH",
            decimals: 18,
        },
        amount_wei: 10_u128.pow(19),
        deployed_block: 9_117_720,
        paymaster_address: None,
        adapter_address: None,
    };

    pub const ETHEREUM_ETHER_100: Pool = Pool {
        chain_id: 1,
        address: address!("0xA160cdAB225685dA1d56aa342Ad8841c3b53f291"),
        asset: Asset::Native {
            symbol: "ETH",
            decimals: 18,
        },
        amount_wei: 10_u128.pow(20),
        deployed_block: 9_161_895,
        paymaster_address: None,
        adapter_address: None,
    };

    pub const POLYGON_MATIC_100: Pool = Pool {
        chain_id: 137,
        address: address!("0x1E34A77868E19A6647b1f2F47B51ed72dEDE95DD"),
        asset: Asset::Native {
            symbol: "MATIC",
            decimals: 18,
        },
        amount_wei: 10_u128.pow(20),
        deployed_block: 16_258_013,
        paymaster_address: None,
        adapter_address: None,
    };

    pub const POLYGON_MATIC_1000: Pool = Pool {
        chain_id: 137,
        address: address!("0xdf231d99Ff8b6c6CBF4E9B9a945CBAcEF9339178"),
        asset: Asset::Native {
            symbol: "MATIC",
            decimals: 18,
        },
        amount_wei: 10_u128.pow(21),
        deployed_block: 16_258_032,
        paymaster_address: None,
        adapter_address: None,
    };

    #[must_use]
    pub fn from_note(note: &Note) -> Option<Self> {
        Self::from_id(&note.amount, &note.symbol, note.chain_id)
    }

    #[must_use]
    pub fn from_id(amount: &str, symbol: &str, chain_id: u64) -> Option<Self> {
        POOLS
            .iter()
            .find(|pool| {
                pool.chain_id == chain_id && pool.symbol() == symbol && pool.amount() == amount
            })
            .copied()
    }

    #[must_use]
    pub fn from_address(address: Address) -> Option<Self> {
        POOLS.iter().find(|pool| pool.address == address).copied()
    }

    #[must_use]
    pub fn symbol(&self) -> String {
        match &self.asset {
            Asset::Native { symbol, .. } | Asset::Erc20 { symbol, .. } => symbol.to_string(),
        }
    }

    /// Decimal amount as a string, e.g. "0.1"
    #[must_use]
    pub fn amount(&self) -> String {
        let decimals = match &self.asset {
            Asset::Native { decimals, .. } | Asset::Erc20 { decimals, .. } => *decimals,
        };

        format_amount(self.amount_wei, decimals)
    }
}

impl Display for Pool {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "eip155:{}/{}/{}",
            self.chain_id,
            self.symbol(),
            self.amount()
        )
    }
}

fn format_amount(amount: u128, decimals: u8) -> String {
    if decimals == 0 {
        return amount.to_string();
    }

    let divisor = 10u128.pow(u32::from(decimals));

    let whole = amount / divisor;
    let frac = amount % divisor;

    if frac == 0 {
        return whole.to_string();
    }

    // Pad fractional part with leading zeros
    let decimals = decimals as usize;
    let mut frac_str = format!("{frac:0decimals$}");

    // Trim trailing zeros
    while frac_str.ends_with('0') {
        frac_str.pop();
    }

    format!("{whole}.{frac_str}")
}

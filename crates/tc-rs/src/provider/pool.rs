use std::fmt::Display;

use alloy::primitives::{Address, address};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Asset {
    Native {
        symbol: String,
        decimals: u8,
    },
    Erc20 {
        address: Address,
        symbol: String,
        decimals: u8,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Pool {
    pub chain_id: u64,
    pub address: Address,
    pub asset: Asset,
    pub amount_wei: u128,
}

impl Pool {
    pub fn sepolia_ether_1() -> Pool {
        Pool {
            chain_id: 11155111,
            address: address!("0x8cc930096b4df705a007c4a039bdfa1320ed2508"),
            asset: Asset::Native {
                symbol: "ETH".to_string(),
                decimals: 18,
            },
            amount_wei: 1 * 10_u128.pow(18),
        }
    }

    pub fn ethereum_ether_100() -> Pool {
        Pool {
            chain_id: 1,
            address: address!("0xA160cdAB225685dA1d56aa342Ad8841c3b53f291"),
            asset: Asset::Native {
                symbol: "ETH".to_string(),
                decimals: 18,
            },
            amount_wei: 100 * 10_u128.pow(18),
        }
    }
}

impl Pool {
    pub fn symbol(&self) -> String {
        match &self.asset {
            Asset::Native { symbol, .. } => symbol.clone(),
            Asset::Erc20 { symbol, .. } => symbol.clone(),
        }
    }

    /// Decimal amount as a string, e.g. "0.1"
    pub fn amount(&self) -> String {
        let decimals = match &self.asset {
            Asset::Native { decimals, .. } => *decimals,
            Asset::Erc20 { decimals, .. } => *decimals,
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

    let decimals = decimals as usize;
    let divisor = 10u128.pow(decimals as u32);

    let whole = amount / divisor;
    let frac = amount % divisor;

    if frac == 0 {
        return whole.to_string();
    }

    // Pad fractional part with leading zeros
    let mut frac_str = format!("{:0width$}", frac, width = decimals);

    // Trim trailing zeros
    while frac_str.ends_with('0') {
        frac_str.pop();
    }

    format!("{whole}.{frac_str}")
}

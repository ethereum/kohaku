use std::{fmt, str::FromStr};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Railgun Address Chain ID.
///
/// Railgun addresses optionally encode a chain ID as an advisory hint for off-chain tooling
/// indicating on which chain the address owner expects to receive funds. The chain ID has no
/// protocol-level enforcement.
#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ChainId {
    All,
    Evm { id: u64 },
}

#[derive(Debug, Error)]
pub enum ChainIdError {
    #[error("ParseInt Error: {0}")]
    ParseInt(#[from] std::num::ParseIntError),

    #[error("Invalid ChainId: {0}")]
    InvalidChainId(u8),

    #[error("Unknown chain type: {0}")]
    UnknownChainType(u8),
}

impl ChainId {
    pub fn evm(id: u64) -> Self {
        ChainId::Evm { id }
    }

    pub fn all() -> Self {
        ChainId::All
    }
}

impl fmt::Display for ChainId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ChainId::All => write!(f, "ffffffffffffffff"),
            ChainId::Evm { id } => {
                // 1 byte chain type (0x00 for EVM) + 7 bytes chain ID
                let encoded = (*id & 0x00ffffffffffffff) as u64; // mask to 7 bytes
                write!(f, "{:016x}", encoded)
            }
        }
    }
}

impl FromStr for ChainId {
    type Err = ChainIdError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let value = u64::from_str_radix(s, 16)?;

        if value == u64::MAX {
            return Ok(ChainId::All);
        }

        let chain_type = (value >> 56) as u8; // high byte
        let chain_id = value & 0x00ffffffffffffff; // low 7 bytes

        match chain_type {
            0x00 => Ok(ChainId::Evm { id: chain_id }),
            _ => Err(ChainIdError::UnknownChainType(chain_type)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_chain_id_to_from_string() {
        let chain_id = ChainId::evm(1);
        let chain_id_str = chain_id.to_string();

        assert_eq!(chain_id_str, "0000000000000001");

        let parsed_chain_id = ChainId::from_str(&chain_id_str).unwrap();
        assert_eq!(chain_id, parsed_chain_id);

        let all_chains = ChainId::all();
        let all_chains_str = all_chains.to_string();

        assert_eq!(all_chains_str, "ffffffffffffffff");

        let parsed_all_chains = ChainId::from_str(&all_chains_str).unwrap();
        assert_eq!(all_chains, parsed_all_chains);
    }
}

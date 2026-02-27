use std::{fmt::Display, str::FromStr};

use alloy::primitives::{Address, U256, Uint};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tsify::Tsify;

use crate::abis::railgun::{TokenData, TokenType};

/// CAIP-10 style Asset ID.  ERC721 and ERC1155 sub-id represented as hex strings.
#[derive(
    Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Tsify,
)]
#[tsify(into_wasm_abi, from_wasm_abi)]
pub enum AssetId {
    Erc20(#[tsify(type = "string")] Address),
    Erc721(
        #[tsify(type = "string")] Address,
        #[tsify(type = "string")] U256,
    ),
    Erc1155(
        #[tsify(type = "string")] Address,
        #[tsify(type = "string")] U256,
    ),
}

impl AssetId {
    pub fn hash(&self) -> U256 {
        let token_data: TokenData = (*self).into();
        token_data.hash()
    }
}

impl Display for AssetId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AssetId::Erc20(address) => write!(f, "erc20:{:?}", address),
            AssetId::Erc721(address, sub_id) => write!(f, "erc721:{:?}/{}", address, sub_id),
            AssetId::Erc1155(address, sub_id) => write!(f, "erc1155:{:?}/{}", address, sub_id),
        }
    }
}

impl From<AssetId> for TokenData {
    fn from(asset_id: AssetId) -> Self {
        match asset_id {
            AssetId::Erc20(address) => TokenData {
                tokenType: TokenType::ERC20,
                tokenAddress: address,
                tokenSubID: Uint::ZERO,
            },
            AssetId::Erc721(address, sub_id) => TokenData {
                tokenType: TokenType::ERC721,
                tokenAddress: address,
                tokenSubID: sub_id,
            },
            AssetId::Erc1155(address, sub_id) => TokenData {
                tokenType: TokenType::ERC1155,
                tokenAddress: address,
                tokenSubID: sub_id,
            },
        }
    }
}

impl From<TokenData> for AssetId {
    fn from(token_data: TokenData) -> Self {
        match token_data.tokenType {
            TokenType::ERC20 => AssetId::Erc20(token_data.tokenAddress),
            TokenType::ERC721 => AssetId::Erc721(token_data.tokenAddress, token_data.tokenSubID),
            TokenType::ERC1155 => AssetId::Erc1155(token_data.tokenAddress, token_data.tokenSubID),
            _ => unreachable!(),
        }
    }
}

#[derive(Debug, Error)]
pub enum AssetIdParseError {
    #[error("Invalid format: expected 'type:address' or 'type:address/subId'")]
    InvalidFormat,
    #[error("Unknown asset type: {0}")]
    UnknownType(String),
    #[error("Invalid address: {0}")]
    InvalidAddress(String),
    #[error("Invalid sub ID: {0}")]
    InvalidSubId(String),
}

impl FromStr for AssetId {
    type Err = AssetIdParseError;

    /// Parse an AssetId from a string.
    ///
    /// Supported formats:
    /// - `erc20:0x...` - ERC20 token
    /// - `erc721:0x.../123` - ERC721 token with sub ID
    /// - `erc1155:0x.../456` - ERC1155 token with sub ID
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let (asset_type, rest) = s.split_once(':').ok_or(AssetIdParseError::InvalidFormat)?;

        match asset_type.to_lowercase().as_str() {
            "erc20" => {
                let address: Address = rest
                    .parse()
                    .map_err(|_| AssetIdParseError::InvalidAddress(rest.to_string()))?;
                Ok(AssetId::Erc20(address))
            }
            "erc721" => {
                let (addr_str, sub_id_str) = rest
                    .split_once('/')
                    .ok_or(AssetIdParseError::InvalidFormat)?;
                let address: Address = addr_str
                    .parse()
                    .map_err(|_| AssetIdParseError::InvalidAddress(addr_str.to_string()))?;
                let sub_id: U256 = sub_id_str
                    .parse()
                    .map_err(|_| AssetIdParseError::InvalidSubId(sub_id_str.to_string()))?;
                Ok(AssetId::Erc721(address, sub_id))
            }
            "erc1155" => {
                let (addr_str, sub_id_str) = rest
                    .split_once('/')
                    .ok_or(AssetIdParseError::InvalidFormat)?;
                let address: Address = addr_str
                    .parse()
                    .map_err(|_| AssetIdParseError::InvalidAddress(addr_str.to_string()))?;
                let sub_id: U256 = sub_id_str
                    .parse()
                    .map_err(|_| AssetIdParseError::InvalidSubId(sub_id_str.to_string()))?;
                Ok(AssetId::Erc1155(address, sub_id))
            }
            _ => Err(AssetIdParseError::UnknownType(asset_type.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_erc20_hash_snap() {
        let erc20 = AssetId::Erc20(Address::from_slice(&[1u8; 20]));
        let hash = erc20.hash();
        insta::assert_debug_snapshot!(hash);

        let recovered: AssetId = TokenData::from_hash(&hash.to_be_bytes_vec())
            .unwrap()
            .into();
        assert_eq!(recovered, erc20);
    }

    #[test]
    fn test_erc721_hash_snap() {
        let erc721 = AssetId::Erc721(Address::from_slice(&[2u8; 20]), U256::from(123));
        let hash = erc721.hash();
        insta::assert_debug_snapshot!(hash);
    }

    #[test]
    fn test_erc1155_hash_snap() {
        let erc1155 = AssetId::Erc1155(Address::from_slice(&[3u8; 20]), U256::from(456));
        let hash = erc1155.hash();
        insta::assert_debug_snapshot!(hash);
    }
}

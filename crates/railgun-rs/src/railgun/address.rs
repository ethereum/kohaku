use std::{fmt::Display, str::FromStr};

use bech32::Hrp;
use serde::{self, Deserialize, Serialize};
use thiserror::Error;
use tracing::warn;
use tsify::Tsify;

use crate::crypto::keys::{
    HexKey, KeyError, MasterPublicKey, SpendingKey, ViewingKey, ViewingPublicKey,
};

#[derive(
    Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Tsify,
)]
#[serde(try_from = "String", into = "String")]
#[tsify(from_wasm_abi, into_wasm_abi, type = "String")]
pub struct RailgunAddress {
    master_key: MasterPublicKey,
    viewing_pubkey: ViewingPublicKey,
    chain_id: ChainId,
}

#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum ChainId {
    EVM(alloy::primitives::ChainId),
    All,
}

#[derive(Debug, Error)]
pub enum RailgunAddressError {
    #[error("Bech32 decoding error: {0}")]
    Bech32Decode(#[from] bech32::DecodeError),
    #[error("Invalid Prefix: {0}")]
    InvalidPrefix(String),
    #[error("ParseInt Error: {0}")]
    ParseInt(#[from] std::num::ParseIntError),
    #[error("Key Error: {0}")]
    Key(#[from] KeyError),
    #[error("Invalid ChainId: {0}")]
    InvalidChainId(u8),
    #[error("Invalid Version: {0}")]
    InvalidVersion(u8),
    #[error("Hex decoding error: {0}")]
    HexDecode(#[from] hex::FromHexError),
}

const ADDRESS_LENGTH_LIMIT: usize = 127;
const PREFIX: Hrp = Hrp::parse_unchecked("0zk");
const ADDRESS_VERSION: u8 = 1;
const ALL_CHAINS_NETWORK_ID: u8 = 255;

impl RailgunAddress {
    pub fn new(
        master_key: MasterPublicKey,
        viewing_pubkey: ViewingPublicKey,
        chain_id: ChainId,
    ) -> Self {
        RailgunAddress {
            master_key,
            viewing_pubkey,
            chain_id,
        }
    }

    pub fn from_private_keys(
        spending_key: SpendingKey,
        viewing_key: ViewingKey,
        chain_id: ChainId,
    ) -> Self {
        let master_key =
            MasterPublicKey::new(spending_key.public_key(), viewing_key.nullifying_key());

        RailgunAddress::new(master_key, viewing_key.public_key(), chain_id)
    }

    pub fn master_key(&self) -> MasterPublicKey {
        self.master_key
    }

    pub fn viewing_pubkey(&self) -> ViewingPublicKey {
        self.viewing_pubkey
    }

    pub fn chain(&self) -> ChainId {
        self.chain_id
    }
}

impl Display for RailgunAddress {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let network_id = xor_network_id(&encode_chain_id(&self.chain_id));

        let address_string = format!(
            "{:02}{}{}{}",
            ADDRESS_VERSION,
            self.master_key.to_hex(),
            network_id,
            self.viewing_pubkey.to_hex(),
        );

        let payload = hex::decode(address_string).unwrap();
        let address_buffer = bech32::encode::<bech32::Bech32m>(PREFIX, &payload).unwrap();

        if address_buffer.len() > ADDRESS_LENGTH_LIMIT {
            panic!("Generated address exceeds length limit");
        }

        write!(f, "{}", address_buffer)
    }
}

impl FromStr for RailgunAddress {
    type Err = RailgunAddressError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let (hrp, payload) = bech32::decode(s)?;
        let address_hex = hex::encode(payload);

        if hrp != PREFIX {
            return Err(RailgunAddressError::InvalidPrefix(hrp.to_string()));
        }

        let version = u8::from_str_radix(&address_hex[0..2], 16)?;
        let master_key = MasterPublicKey::from_hex(&address_hex[2..66])?;
        let chain_id = decode_network_id(&xor_network_id(&address_hex[66..82]))?;
        let viewing_pubkey = ViewingPublicKey::from_hex(&address_hex[82..146])?;

        if version != ADDRESS_VERSION {
            return Err(RailgunAddressError::InvalidVersion(version));
        }

        Ok(RailgunAddress {
            master_key,
            viewing_pubkey,
            chain_id,
        })
    }
}

impl TryFrom<String> for RailgunAddress {
    type Error = RailgunAddressError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        value.parse()
    }
}

impl From<RailgunAddress> for String {
    fn from(address: RailgunAddress) -> Self {
        address.to_string()
    }
}

fn encode_chain_id(chain: &ChainId) -> String {
    match chain {
        ChainId::EVM(id) => encode_evm_chain_id(*id),
        ChainId::All => format!("{:02x}", ALL_CHAINS_NETWORK_ID),
    }
}

fn encode_evm_chain_id(chain_id: alloy::primitives::ChainId) -> String {
    let mut bytes = [0u8; 8];
    bytes[0] = 0;
    bytes[1..].copy_from_slice(&chain_id.to_be_bytes()[1..]);
    hex::encode(bytes)
}

fn decode_network_id(encoded: &str) -> Result<ChainId, RailgunAddressError> {
    let encoded = hex::decode(encoded).map_err(RailgunAddressError::HexDecode)?;
    match encoded[0] {
        0 => {
            let mut id_bytes = [0u8; 8];
            id_bytes.copy_from_slice(&encoded[..8]);
            id_bytes[0] = 0;
            let id = u64::from_be_bytes(id_bytes);
            Ok(ChainId::EVM(id))
        }
        ALL_CHAINS_NETWORK_ID => Ok(ChainId::All),
        _ => {
            warn!("Invalid chain ID in address: {}", hex::encode(&encoded));
            Err(RailgunAddressError::InvalidChainId(encoded[0]))
        }
    }
}

fn xor_network_id(network_id_hex: &str) -> String {
    let network_bytes = hex::decode(network_id_hex).expect("invalid hex in network ID");
    let railgun = b"railgun";
    let mut result = Vec::with_capacity(network_bytes.len());
    for (i, byte) in network_bytes.iter().enumerate() {
        let xor_byte = if i < railgun.len() { railgun[i] } else { 0 };
        result.push(byte ^ xor_byte);
    }
    hex::encode(result)
}

#[cfg(test)]
mod tests {
    use tracing_test::traced_test;

    use super::*;
    use crate::crypto::keys::ByteKey;

    #[test]
    #[traced_test]
    fn test_railgun_address_to_from_string() {
        let master_key = MasterPublicKey::from_bytes([1u8; 32]);
        let viewing_pubkey = ViewingPublicKey::from_bytes([2u8; 32]);
        let chain = 1;
        let railgun_address = RailgunAddress::new(master_key, viewing_pubkey, ChainId::EVM(chain));

        let address_string = railgun_address.to_string();
        let expected_address_string = "0zk1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszunpd9kxwatwqypqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqy3t4umn";
        assert_eq!(address_string, expected_address_string);

        let parsed: RailgunAddress = address_string.parse().unwrap();
        assert_eq!(parsed, railgun_address);
    }

    // #[test]
    // #[traced_test]
    // fn test_railgun_address_all_chains() {
    //     let address = "0zk1qykqj8ed50tfm8a4ezl2qekk3aqxuq37pgv88pv6s9phk0vj3lv7erv7j6fe3z53la8hh9taj9xq34y835wrscryymjf8qqrasmm2vxrm68y0qsxtcvzj6paxpy";
    //     let parsed: RailgunAddress = address.parse().unwrap();
    //     assert_eq!(parsed.chain(), ChainId::All);

    //     let address_string = parsed.to_string();
    //     assert_eq!(address_string, address);
    // }
}

use std::{fmt::Display, str::FromStr};

use bech32::Hrp;
use serde::{self, Deserialize, Serialize};
use thiserror::Error;

use crate::{
    account::chain::{ChainId, ChainIdError},
    crypto::keys::{ByteKey, KeyError, MasterPublicKey, SpendingKey, ViewingKey, ViewingPublicKey},
};

/// Railgun address
///
/// Railgun addresses are the primary identifiers for users within the Railgun protocol, encoding
/// the public key material required to send transactions to the addressed account, as well as an
/// optional advisory chain ID.
#[derive(Debug, Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
#[cfg_attr(js, derive(tsify::Tsify))]
#[cfg_attr(js, tsify(from_wasm_abi, into_wasm_abi, type = "`0zk${string}`"))]
pub struct RailgunAddress {
    master_key: MasterPublicKey,
    viewing_pubkey: ViewingPublicKey,
    chain_id: ChainId,
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
    #[error("Chain ID parsing error: {0}")]
    ChainId(#[from] ChainIdError),
}

const PREFIX: Hrp = Hrp::parse_unchecked("0zk");
const ADDRESS_VERSION: u8 = 1;

impl RailgunAddress {
    pub fn from_public_keys(
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

        RailgunAddress::from_public_keys(master_key, viewing_key.public_key(), chain_id)
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
        let network_id_hex = xor_network_id(&self.chain_id.to_string());
        let network_id = hex::decode(network_id_hex).unwrap();

        let mut payload = Vec::with_capacity(73);
        payload.push(ADDRESS_VERSION);
        payload.extend_from_slice(self.master_key.as_bytes());
        payload.extend_from_slice(&network_id);
        payload.extend_from_slice(self.viewing_pubkey.as_bytes());

        let encoded = bech32::encode::<bech32::Bech32m>(PREFIX, &payload).unwrap();
        write!(f, "{}", encoded)
    }
}

impl FromStr for RailgunAddress {
    type Err = RailgunAddressError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let (hrp, payload) = bech32::decode(s)?;

        if hrp != PREFIX {
            return Err(RailgunAddressError::InvalidPrefix(hrp.to_string()));
        }

        let version = payload[0];
        if version != ADDRESS_VERSION {
            return Err(RailgunAddressError::InvalidVersion(version));
        }

        let master_key = MasterPublicKey::from_bytes(payload[1..33].try_into().unwrap());
        let network_id = xor_network_id(&hex::encode(&payload[33..41]));
        let chain_id = ChainId::from_str(&network_id)?;
        let viewing_pubkey = ViewingPublicKey::from_bytes(payload[41..73].try_into().unwrap());

        Ok(RailgunAddress {
            master_key,
            viewing_pubkey,
            chain_id,
        })
    }
}

//? Redundant with FromStr, but required for serde's try_from
impl TryFrom<String> for RailgunAddress {
    type Error = RailgunAddressError;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        value.parse()
    }
}

//? Redundant with Display, but required for serde's into
impl From<RailgunAddress> for String {
    fn from(address: RailgunAddress) -> Self {
        address.to_string()
    }
}

fn xor_network_id(network_id: &str) -> String {
    let bytes = hex::decode(network_id).expect("valid hex");
    let key = b"railgun\x00"; // 8-byte key
    let xored: Vec<u8> = bytes.iter().zip(key.iter()).map(|(a, b)| a ^ b).collect();
    hex::encode(xored)
}

#[cfg(all(test, not(target_arch = "wasm32")))]
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
        let railgun_address =
            RailgunAddress::from_public_keys(master_key, viewing_pubkey, ChainId::evm(chain));

        let address_string = railgun_address.to_string();
        let expected_address_string = "0zk1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszunpd9kxwatwqypqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqy3t4umn";
        assert_eq!(address_string, expected_address_string);

        let parsed: RailgunAddress = address_string.parse().unwrap();
        assert_eq!(parsed, railgun_address);
    }

    #[test]
    #[traced_test]
    fn test_railgun_address_all_chains() {
        let address = "0zk1qykqj8ed50tfm8a4ezl2qekk3aqxuq37pgv88pv6s9phk0vj3lv7erv7j6fe3z53la8hh9taj9xq34y835wrscryymjf8qqrasmm2vxrm68y0qsxtcvzj6paxpy";
        let parsed: RailgunAddress = address.parse().unwrap();
        assert_eq!(parsed.chain(), ChainId::All);

        let address_string = parsed.to_string();
        assert_eq!(address_string, address);
    }
}

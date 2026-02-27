use ruint::aliases::U256;
use serde::Deserialize;
use serde_with::{DeserializeAs, SerializeAs};

/// Utility for deserializing U256 values that may be shorter than 64 characters
/// by padding them with leading zeros.
pub struct PaddedU256;

impl SerializeAs<U256> for PaddedU256 {
    fn serialize_as<S>(value: &U256, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        let s = format!("{:0>64x}", value);
        serializer.serialize_str(&s)
    }
}

impl<'de> DeserializeAs<'de, U256> for PaddedU256 {
    fn deserialize_as<D>(deserializer: D) -> Result<U256, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let s = s.strip_prefix("0x").unwrap_or(&s);
        let padded = format!("{:0>64}", s);

        U256::from_str_radix(&padded, 16).map_err(serde::de::Error::custom)
    }
}

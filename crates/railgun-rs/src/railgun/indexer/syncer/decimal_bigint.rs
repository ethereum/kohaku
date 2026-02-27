use ruint::aliases::U256;

/// U256 wrapper that serializes to and from decimal strings
#[derive(Debug, Clone)]
pub struct DecimalU256(pub U256);

impl std::fmt::Display for DecimalU256 {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<U256> for DecimalU256 {
    fn from(v: U256) -> Self {
        DecimalU256(v)
    }
}

impl From<DecimalU256> for U256 {
    fn from(b: DecimalU256) -> Self {
        b.0
    }
}

// For serde serialization as decimal string
impl serde::Serialize for DecimalU256 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> serde::Deserialize<'de> for DecimalU256 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let u = U256::from_str_radix(&s, 10).map_err(serde::de::Error::custom)?;
        Ok(DecimalU256(u))
    }
}

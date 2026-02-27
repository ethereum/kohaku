pub mod u256_hex {
    use ruint::aliases::U256;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S>(value: &U256, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&format!("{:064x}", value))
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<U256, D::Error>
    where
        D: Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let s = s.strip_prefix("0x").unwrap_or(&s);

        U256::from_str_radix(s, 16).map_err(serde::de::Error::custom)
    }
}

pub mod vec_u256_hex {
    use ruint::aliases::U256;
    use serde::{Deserialize, Deserializer, Serialize, Serializer};

    pub fn serialize<S>(values: &Vec<U256>, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let strings: Vec<String> = values.iter().map(|v| format!("{:064x}", v)).collect();
        strings.serialize(serializer)
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<Vec<U256>, D::Error>
    where
        D: Deserializer<'de>,
    {
        let strings = Vec::<String>::deserialize(deserializer)?;
        strings
            .into_iter()
            .map(|s| {
                let s = s.strip_prefix("0x").unwrap_or(&s);
                U256::from_str_radix(s, 16).map_err(serde::de::Error::custom)
            })
            .collect()
    }
}

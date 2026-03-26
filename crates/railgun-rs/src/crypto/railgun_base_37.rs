//! Railgun Base 37 encoding and decoding implementation in Rust.

use thiserror::Error;

const CHARSET: &[u8] = b" 0123456789abcdefghijklmnopqrstuvwxyz";
const BASE: u128 = CHARSET.len() as u128;

#[derive(Debug, Error)]
pub enum EncodingError {
    #[error("invalid character: {0}")]
    InvalidCharacter(char),
    #[error("output exceeds {0} bytes")]
    OutputTooLong(usize),
}

/// Encodes a string into a 16-byte array using Railgun's base 37 encoding.
pub fn encode(text: &str) -> Result<[u8; 16], EncodingError> {
    let mut value: u128 = 0;

    for c in text.chars() {
        let idx = CHARSET
            .iter()
            .position(|&b| b == c as u8)
            .ok_or(EncodingError::InvalidCharacter(c))?;

        value = value
            .checked_mul(BASE)
            .and_then(|v| v.checked_add(idx as u128))
            .ok_or(EncodingError::OutputTooLong(16))?;
    }

    Ok(value.to_be_bytes())
}

/// Decodes a 16-byte array back into a string using Railgun's base 37 encoding.
pub fn decode(bytes: &[u8; 16]) -> String {
    let mut value = u128::from_be_bytes(*bytes);

    let mut result = Vec::new();
    while value > 0 {
        let remainder = (value % BASE) as usize;
        result.push(CHARSET[remainder]);
        value /= BASE;
    }

    result.reverse();
    String::from_utf8(result).unwrap()
}

#[cfg(test)]
mod tests {
    use tracing_test::traced_test;

    use super::*;

    #[test]
    #[traced_test]
    fn encode_expected() {
        // Expected value sourced from Railgun SDK to ensure compatibility
        let text = "hello world";
        let expected: [u8; 16] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 58, 182, 27, 136, 104, 32, 128];
        let encoded = encode(text).unwrap();
        assert_eq!(encoded, expected);
    }

    #[test]
    #[traced_test]
    fn roundtrip() {
        let texts = ["", "hello", "railgun", "0x1234", "test 123"];
        for text in texts {
            let encoded = encode(text).unwrap();
            let decoded = decode(&encoded);
            assert_eq!(decoded, text);
        }
    }

    #[test]
    #[traced_test]
    fn invalid_char() {
        assert!(matches!(
            encode("HELLO"),
            Err(EncodingError::InvalidCharacter('H'))
        ));
    }
}

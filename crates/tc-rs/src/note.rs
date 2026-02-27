use std::{fmt::Display, str::FromStr};

use crypto::pedersen_hash;
use rand::Rng;
use ruint::aliases::U256;
use thiserror::Error;

/// TC deposit note
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Note {
    /// 31-byte little-endian nullifier (248 bits of entropy).
    pub nullifier: [u8; 31],
    /// 31-byte little-endian secret (248 bits of entropy).
    pub secret: [u8; 31],

    pub symbol: String,
    pub amount: String,
    pub chain_id: u64,
}

#[derive(Debug, Error)]
pub enum NoteError {
    #[error("invalid note format")]
    InvalidFormat,
    #[error("invalid chain id")]
    InvalidChainId,
    #[error("invalid hex: {0}")]
    InvalidHex(#[from] hex::FromHexError),
}

impl Note {
    pub fn new(
        nullifier: [u8; 31],
        secret: [u8; 31],
        symbol: String,
        amount: String,
        chain_id: u64,
    ) -> Self {
        Self {
            nullifier,
            secret,
            symbol,
            amount,
            chain_id,
        }
    }

    /// Generate a fresh random note for the given pool
    pub fn random<R: Rng>(rng: &mut R, symbol: &str, amount: &str, chain_id: u64) -> Self {
        Self {
            nullifier: rng.random(),
            secret: rng.random(),
            symbol: symbol.to_string(),
            amount: amount.to_string(),
            chain_id,
        }
    }

    pub fn preimage(&self) -> [u8; 62] {
        let mut buf = [0u8; 62];
        buf[..31].copy_from_slice(&self.nullifier);
        buf[31..].copy_from_slice(&self.secret);
        buf
    }

    pub fn commitment(&self) -> U256 {
        pedersen_hash(&self.preimage())
    }

    pub fn nullifier_hash(&self) -> U256 {
        pedersen_hash(&self.nullifier)
    }
}

impl Display for Note {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "tornado-{}-{}-{}-0x{}",
            self.symbol,
            self.amount,
            self.chain_id,
            hex::encode(self.preimage())
        )
    }
}

impl FromStr for Note {
    type Err = NoteError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        // Format: tornado-{symbol}-{amount}-{chain_id}-0x{124-char hex}
        let parts: Vec<&str> = s.splitn(5, '-').collect();
        if parts.len() != 5 || parts[0] != "tornado" {
            return Err(NoteError::InvalidFormat);
        }

        let symbol = parts[1].to_string();
        let amount = parts[2].to_string();
        let chain_id: u64 = parts[3].parse().map_err(|_| NoteError::InvalidChainId)?;

        let hex_str = parts[4].strip_prefix("0x").unwrap_or(parts[4]);
        let bytes = hex::decode(hex_str)?;
        if bytes.len() != 62 {
            return Err(NoteError::InvalidFormat);
        }

        let mut nullifier = [0u8; 31];
        let mut secret = [0u8; 31];
        nullifier.copy_from_slice(&bytes[..31]);
        secret.copy_from_slice(&bytes[31..]);

        Ok(Note {
            nullifier,
            secret,
            symbol,
            amount,
            chain_id,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_note_encoding_decoding() {
        let nullifier = [1u8; 31];
        let secret = [2u8; 31];
        let symbol = "ETH".to_string();
        let amount = "1".to_string();
        let chain_id = 1;
        let note = Note::new(nullifier, secret, symbol.clone(), amount.clone(), chain_id);
        let encoded = note.to_string();

        insta::assert_debug_snapshot!(encoded);

        let decoded_note = Note::from_str(&encoded).unwrap();
        assert_eq!(note, decoded_note);
    }
}

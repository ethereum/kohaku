use std::str::FromStr;

use ark_bn254::Fr;
use ark_ff::{BigInteger, PrimeField};
use num_bigint::{BigInt as NumBigInt, Sign};
use ruint::{aliases::U256, uint};

pub const Q: U256 =
    uint!(21888242871839275222246405745257275088548364400416034343698204186575808495617_U256);

pub const ORDER: U256 =
    uint!(21888242871839275222246405745257275088614511777268538073601725287587578984328_U256);

pub const A: u64 = 168700;
pub const D: u64 = 168696;

pub fn fr_from_u64(x: u64) -> Fr {
    Fr::from(x)
}

pub fn fr_from_u256(x: U256) -> Fr {
    Fr::from_str(&x.to_string()).unwrap()
}

pub fn u256_to_num_bigint(x: U256) -> NumBigInt {
    NumBigInt::from_bytes_le(Sign::Plus, &x.to_le_bytes::<32>())
}

pub fn fr_to_num_bigint(f: Fr) -> NumBigInt {
    let le = f.into_bigint().to_bytes_le();
    NumBigInt::from_bytes_le(Sign::Plus, &le)
}

pub fn test_bit(bytes: &[u8], i: usize) -> bool {
    bytes[i / 8] & (1 << (i % 8)) != 0
}

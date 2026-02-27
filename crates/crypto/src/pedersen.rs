use std::str::FromStr;

use ark_bn254::Fr;
use ark_ff::{AdditiveGroup, Field};
use blake_hash::{Blake256, Digest, digest::FixedOutput};
use num_bigint::{BigInt, Sign};
use ruint::aliases::U256;

use crate::{
    babyjubjub::Point,
    common::{A, D, ORDER, Q, fr_from_u64, fr_to_num_bigint, test_bit, u256_to_num_bigint},
};

const WINDOW_SIZE: usize = 4;
const N_WINDOWS_PER_SEGMENT: usize = 50;
const BITS_PER_SEGMENT: usize = WINDOW_SIZE * N_WINDOWS_PER_SEGMENT;

/// Circomlib-compatible Pedersen hash over BabyJubJub.
///
/// Converts `data` to a bit array (LSB first), partitions into segments of
/// 200 bits, encodes each segment as a signed-window scalar, multiplies by
/// the corresponding generator point, and returns the x-coordinate of the
/// accumulated point.
pub fn pedersen_hash(data: &[u8]) -> U256 {
    let bits: Vec<bool> = (0..data.len() * 8).map(|i| test_bit(data, i)).collect();
    let n_segments = (bits.len().saturating_sub(1) / BITS_PER_SEGMENT) + 1;

    let mut acc = Point {
        x: Fr::ZERO,
        y: Fr::ONE,
    };

    for s in 0..n_segments {
        let segment_bits =
            &bits[s * BITS_PER_SEGMENT..((s + 1) * BITS_PER_SEGMENT).min(bits.len())];

        let mut escalar = segment_scalar(segment_bits);
        if escalar.sign() == Sign::Minus {
            escalar += u256_to_num_bigint(ORDER >> 3);
        }

        let contribution = get_base_point(s).mul_scalar(&escalar);
        acc = acc.projective().add(&contribution.projective()).affine();
    }

    let x_big = fr_to_num_bigint(acc.x);
    let (_, bytes_le) = x_big.to_bytes_le();
    U256::from_le_slice(&bytes_le)
}

/// Encode a segment's bits as a signed scalar.
///
/// Each 4-bit window contributes `acc * 2^(5w)` to the scalar, where `acc`
/// starts at 1, bits 0-2 add magnitude, and bit 3 negates. The exponent
/// advances by 5 (not 4) so that the signed-magnitude encoding is injective.
fn segment_scalar(bits: &[bool]) -> BigInt {
    let mut escalar = BigInt::ZERO;
    let mut exp = BigInt::from(1u8);
    let mut i = 0;

    for _ in 0..N_WINDOWS_PER_SEGMENT {
        if i >= bits.len() {
            break;
        }

        let mut acc = BigInt::from(1u8);

        for b in 0..(WINDOW_SIZE - 1) {
            if i < bits.len() && bits[i] {
                acc += BigInt::from(1u8) << b;
            }
            i += 1;
        }

        if i < bits.len() && bits[i] {
            acc = -acc;
        }
        i += 1;

        escalar += &acc * &exp;
        exp <<= WINDOW_SIZE + 1;
    }

    escalar
}

/// Derive the s-th Pedersen generator point.
///
/// Hashes the string `"PedersenGenerator_{s:032}_{try:032}"` with Blake-256,
/// clears the 254th bit (circomlib convention), unpacks the resulting bytes as
/// a BabyJubJub point, multiplies by 8 to clear the cofactor, and returns the
/// first such point that lies in the prime-order subgroup.
fn get_base_point(point_idx: usize) -> Point {
    for try_idx in 0.. {
        let seed = format!("PedersenGenerator_{point_idx:032}_{try_idx:032}");
        let mut h = blake256(seed.as_bytes());
        h[31] &= 0xbf; // clear bit 254 (circomlib convention)

        if let Some(p) = unpack_point(&h) {
            let p8 = p.mul_scalar(&BigInt::from(8u8));
            if in_subgroup(&p8) {
                return p8;
            }
        }
    }
    unreachable!()
}

/// Unpack a 32-byte compressed BabyJubJub point.
///
/// Bytes are a LE-encoded y-coordinate; the high bit of byte 31 is the sign of
/// x (1 = x > p/2). Returns `None` if y ≥ p or x² has no square root.
fn unpack_point(buff: &[u8; 32]) -> Option<Point> {
    let mut y_bytes = *buff;
    let sign = y_bytes[31] & 0x80 != 0;
    y_bytes[31] &= 0x7f;

    let y_big = BigInt::from_bytes_le(Sign::Plus, &y_bytes);
    if y_big >= u256_to_num_bigint(Q) {
        return None;
    }

    let y = Fr::from_str(&y_big.to_string()).ok()?;
    let y2 = y.square();

    // x² = (1 - y²) / (A - D·y²)  from the twisted Edwards equation A·x² + y² = 1 + D·x²·y²
    let x2 = (Fr::ONE - y2) * (fr_from_u64(A) - fr_from_u64(D) * y2).inverse()?;
    let mut x = x2.sqrt()?;

    // ark-ff sqrt() returns an arbitrary root; circomlib always returns the root < p/2.
    // Normalize to that convention, then apply the sign bit.
    if fr_to_num_bigint(x) > u256_to_num_bigint(Q) / 2u64 {
        x = -x;
    }
    if sign {
        x = -x;
    }

    Some(Point { x, y })
}

fn in_subgroup(p: &Point) -> bool {
    let r = p.mul_scalar(&u256_to_num_bigint(ORDER >> 3));
    r.x == Fr::ZERO && r.y == Fr::ONE
}

fn blake256(data: &[u8]) -> [u8; 32] {
    let mut h = Blake256::default();
    h.input(data);
    let mut out = [0u8; 32];
    out.copy_from_slice(&h.fixed_result());
    out
}

#[cfg(test)]
mod tests {
    use ruint::uint;

    use super::*;

    #[test]
    fn test_pedersen_hash() {
        // Expected value verified against circomlib's pedersenHash("Hello, world!")
        let hash = pedersen_hash(b"Hello, world!");
        assert_eq!(
            hash,
            uint!(
                13491600061712299675396441404596955294388976214662355192405913840310160783842_U256
            )
        );
    }
}

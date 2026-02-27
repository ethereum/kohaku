use std::str::FromStr;

use ark_bn254::Fr;
use ark_ff::{AdditiveGroup, Field};
use blake_hash::Digest;
use num_bigint::{BigInt as NumBigInt, Sign};
use num_traits::One;
use poseidon_rust::poseidon_hash;
use ruint::{aliases::U256, uint};

use crate::common::{
    A, D, ORDER, Q, fr_from_u64, fr_from_u256, fr_to_num_bigint, test_bit, u256_to_num_bigint,
};

const B8_X: U256 =
    uint!(5299619240641551281634865583518297030282874472190772894086521144482721001553_U256);

const B8_Y: U256 =
    uint!(16950150798460657717958625567821834550301663161624707787222815936182638968203_U256);

pub struct PrivateKey {
    pub key: [u8; 32],
}

#[derive(Clone, Debug)]
pub struct Signature {
    pub r_b8: Point,
    pub s: NumBigInt,
}

#[derive(Clone, Debug)]
pub struct Point {
    pub x: Fr,
    pub y: Fr,
}

#[derive(Clone, Debug)]
pub struct PointProjective {
    pub x: Fr,
    pub y: Fr,
    pub z: Fr,
}

impl PrivateKey {
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    pub fn import(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() != 32 {
            return Err("imported key must be 32 bytes".to_string());
        }

        let mut key = [0u8; 32];
        key.copy_from_slice(bytes);
        Ok(Self { key })
    }

    pub fn scalar_key(&self) -> NumBigInt {
        // compatible with circomlib blake512
        let hash = blake_hash::Blake512::digest(&self.key);

        let mut h = [0u8; 32];
        h.copy_from_slice(&hash[..32]);

        // prune buffer RFC8032
        h[0] &= 0xF8;
        h[31] &= 0x7F;
        h[31] |= 0x40;

        let sk = NumBigInt::from_bytes_le(Sign::Plus, &h);
        sk >> 3
    }

    pub fn public(&self) -> Point {
        b8().mul_scalar(&self.scalar_key())
    }

    pub fn sign(&self, msg: NumBigInt) -> Result<Signature, Box<dyn std::error::Error>> {
        let q_big = u256_to_num_bigint(Q);
        if msg >= q_big {
            return Err("msg outside field".into());
        }

        let suborder = u256_to_num_bigint(ORDER >> 3);

        // h = blake512(sk)
        let h = blake_hash::Blake512::digest(&self.key);

        // msg_le_32
        let mut msg32 = [0u8; 32];
        let (_, msg_bytes) = msg.to_bytes_le();
        msg32[..msg_bytes.len()].copy_from_slice(&msg_bytes);

        // r_bytes = h[32..64] || msg32
        let mut r_bytes = [0u8; 64];
        r_bytes[..32].copy_from_slice(&h[32..64]);
        r_bytes[32..].copy_from_slice(&msg32);

        // r = blake512(r_bytes) mod suborder
        let r_hashed = blake_hash::Blake512::digest(&r_bytes);
        let mut r = NumBigInt::from_bytes_le(Sign::Plus, &r_hashed);
        r %= &suborder;

        // R = r * B8
        let r_b8 = b8().mul_scalar(&r);

        // A = pk
        let pk = self.public();

        // hm = Poseidon(R.x, R.y, A.x, A.y, msg_fr)
        let msg_fr = Fr::from_str(&msg.to_string())
            .map_err(|_| "msg cannot be converted to field element")?;
        let hm = poseidon_hash(&[r_b8.x, r_b8.y, pk.x, pk.y, msg_fr])?;

        // hm_big = bigint(hm)
        let hm_big = fr_to_num_bigint(hm);

        // s = (r + hm * (scalar_key << 3)) mod suborder
        let mut s = self.scalar_key() << 3;
        s *= hm_big;
        s += r;
        s %= &suborder;

        Ok(Signature { r_b8, s })
    }
}

impl Point {
    pub fn projective(&self) -> PointProjective {
        PointProjective {
            x: self.x,
            y: self.y,
            z: Fr::one(),
        }
    }

    pub fn mul_scalar(&self, n: &NumBigInt) -> Point {
        // double-and-add (same as reference)

        let mut r = PointProjective {
            x: Fr::ZERO,
            y: Fr::one(),
            z: Fr::one(),
        };

        let mut exp = self.projective();

        let (_, bytes) = n.to_bytes_le();
        let bits = n.bits() as usize;

        for i in 0..bits {
            if test_bit(&bytes, i) {
                r = r.add(&exp);
            }
            exp = exp.add(&exp);
        }

        r.affine()
    }
}

impl PointProjective {
    pub fn affine(&self) -> Point {
        if self.z == Fr::ZERO {
            return Point {
                x: Fr::ZERO,
                y: Fr::ZERO,
            };
        }

        let zinv = self.z.inverse().unwrap();
        Point {
            x: self.x * zinv,
            y: self.y * zinv,
        }
    }

    pub fn add(&self, q: &PointProjective) -> PointProjective {
        // add-2008-bbjlp
        // https://hyperelliptic.org/EFD/g1p/auto-twisted-projective.html#addition-add-2008-bbjlp

        let d = fr_from_u64(D);
        let a_coeff = fr_from_u64(A);

        let a = self.z * q.z;
        let b = a.square();
        let c = self.x * q.x;
        let dxy = self.y * q.y;

        let e = d * c * dxy;

        let f = b - e;
        let g = b + e;

        let aux = (self.x + self.y) * (q.x + q.y) - c - dxy;
        let x3 = a * f * aux;

        let ac = a_coeff * c;
        let dac = dxy - ac;
        let y3 = a * g * dac;

        let z3 = f * g;

        PointProjective {
            x: x3,
            y: y3,
            z: z3,
        }
    }
}

pub fn b8() -> Point {
    Point {
        x: fr_from_u256(B8_X),
        y: fr_from_u256(B8_Y),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_public_key() {
        let sk_bytes = [1u8; 32];
        let sk = PrivateKey::new(sk_bytes);
        let pk = sk.public();

        let expected_x = fr_from_u256(uint!(
            15944627324083773346390189001500210680939402028015651549526524193195473201952_U256
        ));
        let expected_y = fr_from_u256(uint!(
            17251889856797524237981285661279357764562574766148660962999867467495459148286_U256
        ));

        assert_eq!(pk.x, expected_x);
        assert_eq!(pk.y, expected_y);
    }

    #[test]
    fn test_sign() {
        let sk_bytes = [1u8; 32];
        let sk = PrivateKey::new(sk_bytes);
        let msg = NumBigInt::from(12345);
        let sig = sk.sign(msg).unwrap();

        let expected_r8_x = fr_from_u256(uint!(
            16645010557452456701448959088580661016911463823507331009854769009925791698150_U256
        ));
        let expected_r8_y = fr_from_u256(uint!(
            10450145626571632149073824042351857150010617503888090720817471417491973277265_U256
        ));
        let expected_s = NumBigInt::from_str(
            "2075797490157831809002838810523428353652008808411614949641351030844510230852",
        )
        .unwrap();

        assert_eq!(sig.r_b8.x, expected_r8_x);
        assert_eq!(sig.r_b8.y, expected_r8_y);
        assert_eq!(sig.s, expected_s);
    }
}

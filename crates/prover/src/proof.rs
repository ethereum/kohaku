use ark_bn254::Bn254;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use tsify::Tsify;

/// Circuit proof
///
/// Serializes into a SnarkJS-compatible format, with decimal strings for all
/// field elements and arrays for the g1 / g2 points.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(from_wasm_abi)]
pub struct Proof {
    #[serde(rename = "pi_a")]
    pub a: G1Affine,
    #[serde(rename = "pi_b")]
    pub b: G2Affine,
    #[serde(rename = "pi_c")]
    pub c: G1Affine,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(type = "[string, string]")]
#[serde(into = "[String; 2]", try_from = "[String; 2]")]
pub struct G1Affine {
    pub x: U256,
    pub y: U256,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Tsify)]
#[tsify(type = "[[string, string], [string, string]]")]
#[serde(into = "[[String; 2]; 2]", try_from = "[[String; 2]; 2]")]
pub struct G2Affine {
    pub x: [U256; 2],
    pub y: [U256; 2],
}

impl From<ark_groth16::Proof<Bn254>> for Proof {
    fn from(proof: ark_groth16::Proof<Bn254>) -> Self {
        Proof {
            a: G1Affine {
                x: ark_ff::BigInt::from(proof.a.x).into(),
                y: ark_ff::BigInt::from(proof.a.y).into(),
            },
            b: G2Affine {
                x: [
                    ark_ff::BigInt::from(proof.b.x.c0).into(),
                    ark_ff::BigInt::from(proof.b.x.c1).into(),
                ],
                y: [
                    ark_ff::BigInt::from(proof.b.y.c0).into(),
                    ark_ff::BigInt::from(proof.b.y.c1).into(),
                ],
            },
            c: G1Affine {
                x: ark_ff::BigInt::from(proof.c.x).into(),
                y: ark_ff::BigInt::from(proof.c.y).into(),
            },
        }
    }
}

impl From<G1Affine> for [String; 2] {
    fn from(point: G1Affine) -> Self {
        [point.x.to_string(), point.y.to_string()]
    }
}

impl TryFrom<[String; 2]> for G1Affine {
    type Error = String;

    fn try_from(value: [String; 2]) -> Result<Self, Self::Error> {
        let x = value[0]
            .parse::<U256>()
            .map_err(|e| format!("Failed to parse G1 x coordinate: {}", e))?;
        let y = value[1]
            .parse::<U256>()
            .map_err(|e| format!("Failed to parse G1 y coordinate: {}", e))?;
        Ok(G1Affine { x, y })
    }
}

impl From<G2Affine> for [[String; 2]; 2] {
    fn from(point: G2Affine) -> Self {
        [
            [point.x[0].to_string(), point.x[1].to_string()],
            [point.y[0].to_string(), point.y[1].to_string()],
        ]
    }
}

impl TryFrom<[[String; 2]; 2]> for G2Affine {
    type Error = String;

    fn try_from(value: [[String; 2]; 2]) -> Result<Self, Self::Error> {
        let x0 = value[0][0]
            .parse::<U256>()
            .map_err(|e| format!("Failed to parse G2 x[0] coordinate: {}", e))?;
        let x1 = value[0][1]
            .parse::<U256>()
            .map_err(|e| format!("Failed to parse G2 x[1] coordinate: {}", e))?;
        let y0 = value[1][0]
            .parse::<U256>()
            .map_err(|e| format!("Failed to parse G2 y[0] coordinate: {}", e))?;
        let y1 = value[1][1]
            .parse::<U256>()
            .map_err(|e| format!("Failed to parse G2 y[1] coordinate: {}", e))?;
        Ok(G2Affine {
            x: [x0, x1],
            y: [y0, y1],
        })
    }
}

#[cfg(test)]
mod tests {
    use ruint::uint;

    use super::*;

    #[test]
    fn test_proof_serialization() {
        let proof = test_proof();

        let serialized = serde_json::to_string_pretty(&proof).unwrap();
        insta::assert_snapshot!(serialized);

        let deserialized: Proof = serde_json::from_str(&serialized).unwrap();
        assert_eq!(proof, deserialized);
    }

    fn test_proof() -> Proof {
        Proof {
            a: G1Affine {
                x: uint!(12345678901234567890_U256),
                y: uint!(98765432109876543210_U256),
            },
            b: G2Affine {
                x: [
                    uint!(11111111111111111111_U256),
                    uint!(22222222222222222222_U256),
                ],
                y: [
                    uint!(33333333333333333333_U256),
                    uint!(44444444444444444444_U256),
                ],
            },
            c: G1Affine {
                x: uint!(55555555555555555555_U256),
                y: uint!(66666666666666666666_U256),
            },
        }
    }
}

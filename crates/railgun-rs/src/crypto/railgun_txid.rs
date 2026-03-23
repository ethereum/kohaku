use crypto::poseidon_hash;
use ruint::aliases::U256;
use serde::{Deserialize, Serialize, Serializer};

use crate::railgun::merkle_tree::MerkleTree;

/// TxID uniquely identifies a Railgun Operation (`RailgunSmartWallet::Transaction`).
/// Each TxID corresponds to a set of UTXO notes from a single Operation.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash)]
pub struct Txid(U256);

impl Txid {
    pub fn new(nullifiers: &[U256], commitments: &[U256], bound_params_hash: U256) -> Self {
        let max_nullifiers = 13; // Max circuit inputs
        let max_commitments = 13; // Max circuit outputs

        // This is deeply unfortunate given the performance implications
        let mut nullifiers_padded = [MerkleTree::zero(); 13];
        let mut commitments_padded = [MerkleTree::zero(); 13];

        for (i, &nullifier) in nullifiers.iter().take(max_nullifiers).enumerate() {
            nullifiers_padded[i] = nullifier;
        }
        for (i, &commitment) in commitments.iter().take(max_commitments).enumerate() {
            commitments_padded[i] = commitment;
        }

        let nullifiers_hash = poseidon_hash(&nullifiers_padded).unwrap();
        let commitments_hash = poseidon_hash(&commitments_padded).unwrap();

        poseidon_hash(&[nullifiers_hash, commitments_hash, bound_params_hash])
            .unwrap()
            .into()
    }
}

impl From<U256> for Txid {
    fn from(value: U256) -> Self {
        Txid(value)
    }
}

impl Into<U256> for Txid {
    fn into(self) -> U256 {
        self.0
    }
}

impl prover::IntoU256 for Txid {
    fn into_u256(self) -> U256 {
        self.0
    }
}

impl Serialize for Txid {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&format!("{:064x}", self.0))
    }
}

impl<'de> Deserialize<'de> for Txid {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s = String::deserialize(deserializer)?;
        let s = s.strip_prefix("0x").unwrap_or(&s);
        let value = U256::from_str_radix(s, 16).map_err(serde::de::Error::custom)?;
        Ok(Txid(value))
    }
}

#[cfg(test)]
mod tests {
    use ruint::uint;

    use super::*;

    #[test]
    fn test_txid() {
        let txid = Txid::new(
            &[
                uint!(13715694855377408371089601959277332264580227086500088662374474180290571297793_U256),
                uint!(4879960293526035536337105771650901564439892825648159183025591237708347140334_U256),
            ],
            &[
uint!(12207157656628265423438060380057846656543786903997769688185483156243865679225_U256),
uint!(21704732194337337773381894542943230082317724786316223111256657768939470463625_U256),
uint!(3419899127455500147715903774774198308673930432280940502846714726325919416502_U256),
            ],
            uint!(20104295272660775597730850404771326812479727572119535488383037433725311268740_U256),
        );

        insta::assert_debug_snapshot!(txid);
    }
}

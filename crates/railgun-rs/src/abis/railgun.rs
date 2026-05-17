//! Railgun Solidity types.
//!
//! <https://github.com/Railgun-Privacy/contract/blob/9ec09123eb140fdaaf3a5ff1f29d634c353630cd/contracts/logic/Globals.sol>

use alloy::{
    primitives::{Address, ChainId, FixedBytes, aliases::U72, utils::keccak256_cached},
    sol,
    sol_types::SolValue,
};
use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    circuit::proof::Proof,
    crypto::{aes::Ciphertext, railgun_zero::SNARK_PRIME},
};

#[derive(Debug, Error)]
pub enum TokenDataError {
    #[error("Invalid token data hash length")]
    InvalidHashLength,
}

impl TokenData {
    pub fn from_hash(hash: &[u8]) -> Result<Self, TokenDataError> {
        if hash.len() == 32 {
            let token_address = Address::from_slice(&hash[12..32]);
            return Ok(TokenData {
                tokenType: TokenType::ERC20,
                tokenAddress: token_address,
                tokenSubID: U256::ZERO,
            });
        }

        if hash.len() != 96 {
            return Err(TokenDataError::InvalidHashLength);
        }

        let token_type = hash[31];
        let token_type = match token_type {
            1 => TokenType::ERC721,
            2 => TokenType::ERC1155,
            _ => unreachable!(),
        };
        let token_address = Address::from_slice(&hash[44..64]);
        let token_sub_id = U256::from_be_bytes::<32>(hash[64..96].try_into().unwrap());

        Ok(TokenData {
            tokenType: token_type,
            tokenAddress: token_address,
            tokenSubID: token_sub_id,
        })
    }

    pub fn hash(&self) -> ruint::aliases::U256 {
        if self.tokenType == TokenType::ERC20 {
            let mut bytes = [0u8; 32];
            bytes[12..].copy_from_slice(self.tokenAddress.as_slice());
            return U256::from_be_bytes(bytes);
        }

        let token_type = self.tokenType as u8;

        // tokenType (32 bytes) | address (32 bytes) | subID (32 bytes)
        let mut data = Vec::with_capacity(96);
        data.extend_from_slice(&[0u8; 31]);
        data.push(token_type);
        data.extend_from_slice(&[0u8; 12]); // pad address to 32 bytes
        data.extend_from_slice(self.tokenAddress.as_slice());
        data.extend_from_slice(&self.tokenSubID.to_be_bytes::<32>());

        // Hash and mod by SNARK_SCALAR_FIELD
        let hash = hash_to_scalar(&data);

        let mut bytes = [0u8; 32];
        let result_bytes = hash.to_be_bytes::<32>();
        bytes[32 - result_bytes.len()..].copy_from_slice(&result_bytes);
        ruint::aliases::U256::from_be_bytes(bytes)
    }
}

impl From<Proof> for SnarkProof {
    fn from(proof: Proof) -> Self {
        SnarkProof {
            a: G1Point {
                x: proof.a.x,
                y: proof.a.y,
            },
            //? Reversal of x and y for G2 points is required to match the expected format in Solidity
            b: G2Point {
                x: [proof.b.x[1], proof.b.x[0]],
                y: [proof.b.y[1], proof.b.y[0]],
            },
            c: G1Point {
                x: proof.c.x,
                y: proof.c.y,
            },
        }
    }
}

impl BoundParams {
    pub fn new(
        tree_number: u16,
        min_gas_price: u128,
        unshield: UnshieldType,
        chain_id: ChainId,
        adapt_contract: Address,
        adapt_input: &[u8; 32],
        commitment_ciphertexts: Vec<CommitmentCiphertext>,
    ) -> Self {
        BoundParams {
            treeNumber: tree_number,
            minGasPrice: U72::saturating_from(min_gas_price),
            unshield,
            chainID: chain_id,
            adaptContract: adapt_contract,
            adaptParams: adapt_input.into(),
            commitmentCiphertext: commitment_ciphertexts,
        }
    }

    pub fn hash(&self) -> U256 {
        let encoded = self.abi_encode();
        hash_to_scalar(&encoded)
    }
}

impl Transaction {
    pub fn new(
        proof: SnarkProof,
        merkle_root: FixedBytes<32>,
        nullifiers: Vec<FixedBytes<32>>,
        commitments: Vec<FixedBytes<32>>,
        bound_params: BoundParams,
        unshield_preimage: CommitmentPreimage,
    ) -> Self {
        Transaction {
            proof,
            merkleRoot: merkle_root,
            nullifiers: nullifiers,
            commitments: commitments,
            boundParams: bound_params,
            unshieldPreimage: unshield_preimage,
        }
    }
}

fn hash_to_scalar(data: &[u8]) -> U256 {
    let hash = keccak256_cached(data);
    let hash_bigint = U256::from_be_bytes::<32>(hash.as_slice().try_into().unwrap());
    hash_bigint % SNARK_PRIME
}

sol! {
    contract RailgunSmartWallet {
        // Events
        #[derive(Debug, Serialize, Deserialize)]
        event Transact(
            uint256 treeNumber,
            uint256 startPosition,
            bytes32[] hash,
            CommitmentCiphertext[] ciphertext
        );
        #[derive(Debug, Serialize, Deserialize)]
        event Shield(
            uint256 treeNumber,
            uint256 startPosition,
            CommitmentPreimage[] commitments,
            ShieldCiphertext[] shieldCiphertext,
            uint256[] fees
        );
        #[derive(Debug, Serialize, Deserialize)]
        event Unshield(address to, TokenData token, uint256 amount, uint256 fee);
        #[derive(Debug, Serialize, Deserialize)]
        event Nullified(uint16 treeNumber, bytes32[] nullifier);

        // Getter for rootHistory mapping:
        // treeNumber -> root -> seen
        function rootHistory(uint256 treeNumber, bytes32 root) external view returns (bool);

        // Functions
        function shield(ShieldRequest[] calldata _shieldRequests) external;
        function transact(Transaction[] calldata _transactions) external;
    }

    #[derive(Debug, Serialize, Deserialize)]
    struct ShieldRequest {
        CommitmentPreimage preimage;
        ShieldCiphertext ciphertext;
    }

    #[derive(Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
    enum TokenType {
        #[default]
        ERC20,
        ERC721,
        ERC1155
    }

    #[derive(Debug, Default, Serialize, Deserialize)]
    struct TokenData {
        TokenType tokenType;
        address tokenAddress;
        uint256 tokenSubID;
    }

    #[derive(Debug, Serialize, Deserialize)]
    struct CommitmentCiphertext {
        bytes32[4] ciphertext; // Ciphertext order: IV & tag (16 bytes each), encodedMPK (senderMPK XOR receiverMPK), random & amount (16 bytes each), token
        bytes32 blindedSenderViewingKey;
        bytes32 blindedReceiverViewingKey;
        bytes annotationData; // Only for sender to decrypt
        bytes memo; // Added to note ciphertext for decryption
    }

    #[derive(Debug, Serialize, Deserialize)]
    struct ShieldCiphertext {
        bytes32[3] encryptedBundle; // IV shared (16 bytes), tag (16 bytes), random (16 bytes), IV sender (16 bytes), receiver viewing public key (32 bytes)
        bytes32 shieldKey; // Public key to generate shared key from
    }

    #[derive(Debug, Default, Serialize, Deserialize)]
    enum UnshieldType {
        #[default]
        NONE,
        NORMAL,
        REDIRECT
    }

    #[derive(Debug, Serialize, Deserialize)]
    struct BoundParams {
        uint16 treeNumber;
        uint72 minGasPrice; //? Only for type 0 transactions, vestigial for railgun relayers
        UnshieldType unshield;
        uint64 chainID;
        address adaptContract; //? Vestigial for railgun relayers
        bytes32 adaptParams; //? Vestigial for railgun relayers
        // For unshields do not include an element in ciphertext array
        // Ciphertext array length = commitments - unshields
        CommitmentCiphertext[] commitmentCiphertext;
    }

    #[derive(Debug, Serialize, Deserialize)]
    struct Transaction {
        SnarkProof proof;
        bytes32 merkleRoot;
        bytes32[] nullifiers;
        bytes32[] commitments;
        BoundParams boundParams;
        CommitmentPreimage unshieldPreimage;
    }

    #[derive(Debug, Default, Serialize, Deserialize)]
    struct CommitmentPreimage {
        bytes32 npk; // Poseidon(Poseidon(spending public key, nullifying key), random)
        TokenData token; // Token field
        uint120 value; // Note value
    }

    #[derive(Debug, Serialize, Deserialize)]
    struct G1Point {
        uint256 x;
        uint256 y;
    }

    // Encoding of field elements is: X[0] * z + X[1]
    #[derive(Debug, Serialize, Deserialize)]
    struct G2Point {
        uint256[2] x;
        uint256[2] y;
    }

    struct VerifyingKey {
        string artifactsIPFSHash;
        G1Point alpha1;
        G2Point beta2;
        G2Point gamma2;
        G2Point delta2;
        G1Point[] ic;
    }

    #[derive(Debug, Serialize, Deserialize)]
    struct SnarkProof {
        G1Point a;
        G2Point b;
        G1Point c;
    }

    /// RelayAdapt: native wrap + shield entrypoint (see Railgun `RelayAdapt.json` ABI).
    contract RelayAdapt {
        struct Call {
            address to;
            bytes data;
            uint256 value;
        }
        function multicall(bool _requireSuccess, Call[] calldata _calls) external payable;
        function wrapBase(uint256 _amount) external;
        function shield(ShieldRequest[] calldata _shieldRequests) external;
    }
}

impl From<ShieldCiphertext> for Ciphertext {
    fn from(c: ShieldCiphertext) -> Self {
        let iv = c.encryptedBundle[0][..16].try_into().unwrap();
        let tag = c.encryptedBundle[0][16..].try_into().unwrap();
        let data = vec![c.encryptedBundle[1][..16].to_vec()];
        Ciphertext { iv, tag, data }
    }
}

impl From<CommitmentCiphertext> for Ciphertext {
    fn from(c: CommitmentCiphertext) -> Self {
        let iv = c.ciphertext[0][..16].try_into().unwrap();
        let tag = c.ciphertext[0][16..32].try_into().unwrap();

        let mut data: Vec<Vec<u8>> = c.ciphertext[1..]
            .iter()
            .map(|chunk| chunk.to_vec())
            .collect();
        data.push(c.memo.to_vec());

        Ciphertext { iv, tag, data }
    }
}

#[cfg(all(test, native))]
mod tests {
    use alloy::primitives::{Bytes, FixedBytes, address, b256, bytes};
    use ruint::uint;
    use tracing_test::traced_test;

    use crate::{
        abis::railgun::{BoundParams, CommitmentCiphertext, ShieldCiphertext, UnshieldType},
        crypto::aes::Ciphertext,
    };

    #[test]
    #[traced_test]
    fn test_hash_bound_params() {
        let bound_params = BoundParams::new(
            1,
            10,
            UnshieldType::NONE,
            1,
            address!("0x1234567890123456789012345678901234567890"),
            &[5u8; 32],
            vec![CommitmentCiphertext {
                ciphertext: [
                    FixedBytes::from_slice(&[1u8; 32]),
                    FixedBytes::from_slice(&[1u8; 32]),
                    FixedBytes::from_slice(&[1u8; 32]),
                    FixedBytes::from_slice(&[1u8; 32]),
                ],
                blindedSenderViewingKey: FixedBytes::from_slice(&[2u8; 32]),
                blindedReceiverViewingKey: FixedBytes::from_slice(&[3u8; 32]),
                annotationData: Bytes::from(&[4u8; 50]),
                memo: Bytes::from(&[5u8; 50]),
            }],
        );

        let hash = bound_params.hash();
        let expected =
            uint!(653354349844558206886319240777917397850034746873378410801880094244109558523_U256);

        assert_eq!(hash, expected);
    }

    #[test]
    fn test_from_shield_ciphertext() {
        let shield_ciphertext = ShieldCiphertext {
            encryptedBundle: [
                b256!("0xcdc40d1a484d0b9534fb430fd772ee441a0a60310f7e4f45e44f3e1a28927c66"),
                b256!("0xf64f89eb30021e320701bac590c1b86222b54ae203d9a4e884eb6184cbc81e3d"),
                b256!("0x1ea6ad31817027dc894fe811886dcfbbbce303fd9e3a30bd3da8d3af715d10d3"),
            ],
            shieldKey: b256!("0x6a87f04482a545ace6434f50ccc10d718d252a230d17ca6ab577b1d1e44b3967"),
        };

        let ciphertext: Ciphertext = shield_ciphertext.into();
        insta::assert_debug_snapshot!(ciphertext);
    }

    #[test]
    fn test_from_commitment_ciphertext() {
        let commitment_ciphertext = CommitmentCiphertext {
            ciphertext: [
                b256!("0x0701392e79e3b100c865c253aba4758643080ea8a88c70911ce4521fed8e2983"),
                b256!("0x9a47f32a2f239b13f1817f5fabfb35a0ade4c0cff6fb55c9be421875566c63d9"),
                b256!("0x3eb4c3dcae2803efad8434eadca4002ecea8bfb9fefb4dcc7a21d079f978a210"),
                b256!("0xeb817de68266906f3ebb22b714bc0be33c865212ea9804586adbf0dd2d333ec2"),
            ],
            blindedReceiverViewingKey: b256!(
                "0x046dab3ac0f2656b9e9aebd0bc0b886ff5e88026f017089277502e83e32f5547"
            ),
            blindedSenderViewingKey: b256!(
                "0xc936445356cc951b8aedb75ce5c7d59b2ad43f8b68a53ceae2569b0721506ae0"
            ),
            annotationData: bytes!(
                "0x5f627757a9ebf5dd7ca759eebd0dac8ac843f6e4a1f4e298ee7bb0345775f11f11ff05a7a67eb77276766931a9799e5e19fa18c51f14a5772fe0de6019bef864"
            ),
            memo: bytes!("0x3ceb1ca1f1ef0bdf61df88596d"),
        };

        let ciphertext: Ciphertext = commitment_ciphertext.into();
        insta::assert_debug_snapshot!(ciphertext);
    }
}

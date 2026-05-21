use alloy::sol;

sol! {
    contract RailgunSmartWallet {
        enum TokenType {
            ERC20,
            ERC721,
            ERC1155
        }

        struct TokenData {
            TokenType tokenType;
            address tokenAddress;
            uint256 tokenSubID;
        }

        struct CommitmentCiphertext {
            bytes32[4] ciphertext; // Ciphertext order: IV & tag (16 bytes each), encodedMPK (senderMPK XOR receiverMPK), random & amount (16 bytes each), token
            bytes32 blindedSenderViewingKey;
            bytes32 blindedReceiverViewingKey;
            bytes annotationData; // Only for sender to decrypt
            bytes memo; // Added to note ciphertext for decryption
        }

        enum UnshieldType {
            NONE,
            NORMAL,
            REDIRECT
        }

        struct BoundParams {
            uint16 treeNumber;
            uint72 minGasPrice; // Only for type 0 transactions
            UnshieldType unshield;
            uint64 chainID;
            address adaptContract;
            bytes32 adaptParams;
            // For unshields do not include an element in ciphertext array
            // Ciphertext array length = commitments - unshields
            CommitmentCiphertext[] commitmentCiphertext;
        }

        struct Transaction {
            SnarkProof proof;
            bytes32 merkleRoot;
            bytes32[] nullifiers;
            bytes32[] commitments;
            BoundParams boundParams;
            CommitmentPreimage unshieldPreimage;
        }

        struct CommitmentPreimage {
            bytes32 npk; // Poseidon(Poseidon(spending public key, nullifying key), random)
            TokenData token; // Token field
            uint120 value; // Note value
        }

        struct G1Point {
            uint256 x;
            uint256 y;
        }

        // Encoding of field elements is: X[0] * z + X[1]
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

        struct SnarkProof {
            G1Point a;
            G2Point b;
            G1Point c;
        }

        function transact(Transaction[] calldata _transactions) external;
    }
}

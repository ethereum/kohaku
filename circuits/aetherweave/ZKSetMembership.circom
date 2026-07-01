pragma circom 2.0.0;

// MerkleVerify pseudo-component stub
template MerkleVerify(merkle_path_len) {
    signal input leaf_hash;
    signal input root_hash;
    signal input leaf_index;
    signal input merkle_path[merkle_path_len];

    // In a real implementation this would verify the hashes
    // For now, this is just a structural representation
    signal output is_valid;
    is_valid <== 1;
}

template ZKSetMembership() {
    var MerklePathLength = 32;

    // Public inputs
    signal input root_hash;               // Merkle root (256-bit field element)
    signal input leaf_index_pub;          // position of prover's commitment (0-based)
    signal input merkle_path_len;         // log2(|C|)  (e.g., 32 for 2^32 commitments)

    // Private inputs
    signal input commitment;              // Pedersen commitment to the prover's key
    signal input leaf_index_priv;         // same as public, but kept private for the proof
    signal input merkle_path[MerklePathLength]; // dynamic array

    // Enforce private leaf index equals public
    leaf_index_priv === leaf_index_pub;

    // ---------- Helper: Merkle verification ----------
    // Helper function that checks a Merkle path:
    component merkle_verify = MerkleVerify(MerklePathLength);
    merkle_verify.leaf_hash <== commitment;
    merkle_verify.root_hash <== root_hash;
    merkle_verify.leaf_index <== leaf_index_priv;

    for (var i = 0; i < MerklePathLength; i++) {
        merkle_verify.merkle_path[i] <== merkle_path[i];
    }
}

component main {public [root_hash, leaf_index_pub, merkle_path_len]} = ZKSetMembership();

import { LeanIMT, LeanIMTMerkleProof } from "@zk-kit/lean-imt";
import { poseidon } from "maci-crypto/build/ts/hashing";
import { WithdrawalPayload } from "../relayer/interfaces/relayer-client.interface";
import { encodeAbiParameters, keccak256, numberToHex } from "viem";

const SNARK_SCALAR_FIELD = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

/**
 * Generates a Merkle inclusion proof for a given leaf in a set of leaves.
 *
 * @param {bigint[]} leaves - Array of leaves for the Lean Incremental Merkle tree.
 * @param {bigint} leaf - The specific leaf to generate the inclusion proof for.
 * @returns {LeanIMTMerkleProof<bigint>} A lean incremental Merkle tree inclusion proof.
 * @throws {Error} If the leaf is not found in the leaves array.
 */
export function generateMerkleProof(
  leaves: bigint[],
  leaf: bigint,
): LeanIMTMerkleProof<bigint> {
  const tree = new LeanIMT<bigint>((a, b) => poseidon([a, b]));

  tree.insertMany(leaves);

  const leafIndex = tree.indexOf(leaf);

  // if leaf does not exist in tree, throw error
  if (leafIndex === -1) {
    throw new Error(
      "Leaf not found in the leaves array.",
    );
  }

  const proof = tree.generateProof(leafIndex);

  if (proof.siblings.length < 32) {
    proof.siblings = [
      ...proof.siblings,
      ...Array(32 - proof.siblings.length).fill(BigInt(0)),
    ];
  }

  return proof;
}

export function calculateContext(withdrawal: WithdrawalPayload, scope: bigint): string {
  const hash =
    BigInt(
      keccak256(
        encodeAbiParameters(
          [
            {
              name: "withdrawal",
              type: "tuple",
              components: [
                { name: "processooor", type: "address" },
                { name: "data", type: "bytes" },
              ],
            },
            { name: "scope", type: "uint256" },
          ],
          [
            {
              processooor: withdrawal.processooor,
              data: withdrawal.data,
            },
            scope,
          ],
        ),
      ),
    ) % SNARK_SCALAR_FIELD;

  return numberToHex(hash);
}

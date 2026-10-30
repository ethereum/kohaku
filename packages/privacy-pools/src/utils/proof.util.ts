import { PoseidonT3LeanIMT as LeanIMT, LeanIMTMerkleProof } from "@kohaku-eth/poseidon-lean-imt";
import { poseidonT3 } from "@kohaku-eth/poseidon";
import { WithdrawalPayload } from "../relayer/interfaces/relayer-client.interface";
import { encodeAbiParameters, keccak256, numberToHex } from "viem";

export const SNARK_SCALAR_FIELD = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');


export const merkleHash = (a: bigint, b: bigint): bigint => poseidonT3(a, b);

/**
 * Builds a Lean Incremental Merkle tree from the full set of leaves. This is the
 * O(n)-poseidon-hash operation; callers that reuse a tree should cache it and
 * extend it with `tree.insert` rather than rebuilding here.
 *
 * Below {@link PARALLEL_THRESHOLD} leaves the tree is built in-thread, since
 * starting the workers costs more than the hashing itself.
 */
export const PARALLEL_THRESHOLD = 2048;

export async function buildMerkleTree(leaves: bigint[]): Promise<LeanIMT> {
  if (leaves.length === 0) {
    throw new Error("There are no leaves to add");
  }

  if (leaves.length < PARALLEL_THRESHOLD) {
    return new LeanIMT(leaves);
  }

  return LeanIMT.fromLeavesParallel(leaves);
}

export async function computeMerkleTreeRoot(leaves: bigint[]): Promise<bigint> {
  return (await buildMerkleTree(leaves)).root;
}

/**
 * Extracts a Merkle inclusion proof for `leaf` from an already-built tree,
 * padding the siblings to the fixed depth of 32 the circuit expects. This is the
 * cheap part (indexOf + path walk); no hashing of the full tree happens here.
 *
 * @throws {Error} If the leaf is not found in the tree.
 */
export function proofFromTree(
  tree: LeanIMT,
  leaf: bigint,
): LeanIMTMerkleProof {
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

/**
 * Generates a Merkle inclusion proof for a given leaf by building the tree from
 * scratch. Prefer {@link proofFromTree} against a cached tree in hot paths.
 */
export async function generateMerkleProof(
  leaves: bigint[],
  leaf: bigint,
): Promise<LeanIMTMerkleProof> {
  return proofFromTree(await buildMerkleTree(leaves), leaf);
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

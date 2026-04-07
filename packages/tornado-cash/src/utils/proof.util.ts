import { buildMimcSponge } from 'circomlibjs';
import { MerkleTree } from 'fixed-merkle-tree';

// Tornado Merkle tree parameters
const TREE_LEVELS = 20;
// keccak256("tornado") % SNARK_SCALAR_FIELD
const ZERO_VALUE = '21663839004416932945382355908790599225266501822907911457504978515578255421292';

// MiMC Sponge singleton — loaded once at module import, sync after that
type MimcSponge = Awaited<ReturnType<typeof buildMimcSponge>>;

let _sponge: MimcSponge | null = null;

async function buildTree(leaves: bigint[]): Promise<MerkleTree> {
  if (!_sponge) {
    _sponge = await buildMimcSponge();
  }

  const hashFunction = (left: string | number, right: string | number) => _sponge!.F.toString(_sponge!.multiHash([BigInt(left), BigInt(right)]));
  
  return new MerkleTree(TREE_LEVELS, leaves.map(String), {
    zeroElement: ZERO_VALUE,
    hashFunction,
  });
}

export async function computeMerkleTreeRoot(leaves: bigint[]): Promise<bigint> {
  return BigInt((await buildTree(leaves)).root);
}

export type MerkleProof = {
  index: number;
  root: bigint;
  siblings: bigint[];
  pathIndices: number[];
};

/**
 * Generates a Merkle inclusion proof for a given leaf in a set of leaves.
 *
 * @param {bigint[]} leaves - All commitment leaves for the tornado pool.
 * @param {bigint} leaf - The specific commitment to generate the proof for.
 * @returns {MerkleProof} Merkle proof compatible with the tornado withdraw circuit.
 * @throws {Error} If the leaf is not found in the leaves array.
 */
export async function generateMerkleProof(leaves: bigint[], leaf: bigint): Promise<MerkleProof> {
  const tree = await buildTree(leaves);
  const leafStr = leaf.toString();
  const index = tree.indexOf(leafStr);

  if (index === -1) throw new Error('Leaf not found in the leaves array.');

  const { pathElements, pathIndices, pathRoot } = tree.proof(leafStr);

  return {
    index,
    root: BigInt(pathRoot),
    siblings: pathElements.map(BigInt),
    pathIndices,
  };
}


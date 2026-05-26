import { poseidon2, poseidon3 } from "poseidon-lite";

const BN254_FIELD =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const TREE_LEVELS = 20;

export function computeLeafCommitment(
  secret: bigint,
  nullifierPreimage: bigint,
  denomTacit: bigint
): bigint {
  return poseidon3([secret, nullifierPreimage, denomTacit]);
}

export function bigintToBytes32(v: bigint): `0x${string}` {
  return `0x${v.toString(16).padStart(64, "0")}`;
}

export function buildMerkleZeros(): bigint[] {
  const zeros: bigint[] = [0n];
  for (let i = 1; i <= TREE_LEVELS; i++) {
    zeros.push(poseidon2([zeros[i - 1], zeros[i - 1]]));
  }
  return zeros;
}

export function insertLeaf(
  filledSubtrees: bigint[],
  zeros: bigint[],
  leafIndex: number,
  leaf: bigint
): { root: bigint; subtrees: bigint[] } {
  const newSubtrees = [...filledSubtrees];
  let h = leaf;
  let idx = leafIndex;
  for (let i = 0; i < TREE_LEVELS; i++) {
    if ((idx & 1) === 0) {
      newSubtrees[i] = h;
      h = poseidon2([h, zeros[i]]);
    } else {
      h = poseidon2([newSubtrees[i], h]);
    }
    idx >>= 1;
  }
  return { root: h, subtrees: newSubtrees };
}

export function computeMerkleProof(
  leaves: bigint[],
  targetIndex: number
): { pathElements: bigint[]; pathIndices: number[] } {
  const zeros = buildMerkleZeros();
  let layer = [...leaves];
  const pathElements: bigint[] = [];
  const pathIndices: number[] = [];
  let idx = targetIndex;

  for (let level = 0; level < TREE_LEVELS; level++) {
    const sibling =
      (idx ^ 1) < layer.length ? layer[idx ^ 1] : zeros[level];
    pathElements.push(sibling);
    pathIndices.push(idx & 1);

    const nextLayer: bigint[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : zeros[level];
      nextLayer.push(poseidon2([left, right]));
    }
    layer = nextLayer;
    idx >>= 1;
  }

  return { pathElements, pathIndices };
}

export { BN254_FIELD, TREE_LEVELS };

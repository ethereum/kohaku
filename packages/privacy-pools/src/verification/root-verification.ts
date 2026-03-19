import { IDataService } from '../data/interfaces/data.service.interface.js';
import { computeMerkleTreeRoot } from '../utils/proof.util.js';
import { Address } from '../interfaces/types.interface.js';

// Privacy Pool stores the last 64 state roots in a circular buffer on-chain.
// This value must match the contract's ROOT_HISTORY_SIZE exactly so historical
// root lookups wrap over the same slots as _isKnownRoot().
const ROOT_HISTORY_SIZE = 64;

/**
 * Verifies that a locally computed merkle root from leaves matches the expected root.
 * Pure function — no RPC calls.
 */
export function verifyLocalRoot(leaves: bigint[], expectedRoot: bigint): void {
  if (leaves.length === 0) {
    if (expectedRoot !== 0n) {
      throw new Error(
        `Root verification failed: empty leaves but non-zero expected root (${expectedRoot})`
      );
    }

    return;
  }

  const localRoot = computeMerkleTreeRoot(leaves);

  if (localRoot !== expectedRoot) {
    throw new Error(
      'Root verification failed: locally computed root does not match expected root ' +
      `(local=${localRoot}, expected=${expectedRoot})`
    );
  }
}

/**
 * Wraps an index within a ring buffer of the given size,
 * handling negative values from lookback arithmetic.
 */
function wrapIndex(rawIndex: number, historySize: number): number {
  return ((rawIndex % historySize) + historySize) % historySize;
}

/**
 * Verifies that the ASP tree root matches the Entrypoint contract's latestRoot().
 *
 * The Entrypoint validates withdrawal proofs against latestRoot() with exact
 * equality — historical roots are not accepted. This check must mirror that
 * contract behavior to avoid false positives where sync passes locally but
 * proof submission reverts on-chain.
 */
export async function verifyAspRootOnChain(
  dataService: IDataService,
  entrypointAddress: Address,
  expectedRoot: bigint,
): Promise<void> {
  if (expectedRoot === 0n) {
    throw new Error(
      'ASP root verification called with empty root (0n) — caller must filter empty trees'
    );
  }

  const latestRoot = await dataService.getEntrypointLatestRoot(entrypointAddress);

  if (latestRoot === expectedRoot) {
    return;
  }

  throw new Error(
    'ASP root verification failed: expected root does not match Entrypoint latestRoot ' +
    `(expected=${expectedRoot}, latestOnChain=${latestRoot})`
  );
}

/**
 * Verifies that the state tree root is anchored on the Pool contract.
 * Checks currentRoot() first, then walks the full ring buffer to mirror
 * the contract's _isKnownRoot() behavior.
 */
export async function verifyStateRootOnChain(
  dataService: IDataService,
  poolAddress: Address,
  expectedRoot: bigint,
): Promise<void> {
  if (expectedRoot === 0n) {
    throw new Error(
      'State root verification called with empty root (0n) — caller must filter empty trees'
    );
  }

  const onchainRoot = await dataService.getPoolStateRoot(poolAddress);

  if (onchainRoot === expectedRoot) {
    return;
  }

  const currentIndex = await dataService.getPoolCurrentRootIndex(poolAddress);

  for (let offset = 1; offset < ROOT_HISTORY_SIZE; offset++) {
    const idx = wrapIndex(currentIndex - offset, ROOT_HISTORY_SIZE);

    const root = await dataService.getPoolHistoricalRoot(poolAddress, idx);

    if (root === expectedRoot) {
      return;
    }
  }

  throw new Error(
    'State root verification failed: root not found in Pool recent history ' +
    `(expected=${expectedRoot}, currentOnChain=${onchainRoot})`
  );
}

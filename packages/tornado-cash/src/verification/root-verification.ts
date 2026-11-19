import { buildTree } from '#merkle-tree';
import { IDataService } from '../data/interfaces/data.service.interface.js';
import { IRawDepositEvent } from '../data/interfaces/events.interface.js';
import { Address } from '../interfaces/types.interface.js';
import { appendLeaves, emptyFrontier, frontierOf, IMerkleFrontier } from '../utils/merkle-frontier.js';

export interface IVerifyStateRootOnChainParams {
  dataService: IDataService;
  poolAddress: Address;
  expectedRoot: bigint;
}

/**
 * Verifies that the state tree root is anchored on the Pool contract.
 * Checks currentRoot() first, then walks the full ring buffer to mirror
 * the contract's _isKnownRoot() behavior.
 */
export async function verifyStateRootOnChain({
  dataService,
  poolAddress,
  expectedRoot,
}: IVerifyStateRootOnChainParams): Promise<void> {
  if (expectedRoot === 0n) {
    throw new Error(
      'State root verification called with empty root (0n) — caller must filter empty trees'
    );
  }

  const onchainRoot = await dataService.getPoolStateRoot(poolAddress);

  if (onchainRoot === expectedRoot) {
    return;
  }

  const isValidRoot = await dataService.isPoolRootValid(poolAddress, expectedRoot);

  if (isValidRoot) {
    return;
  }

  throw new Error(
    'State root verification failed: root not found in Pool recent history ' +
    `(expected=${expectedRoot}, currentOnChain=${onchainRoot})`
  );
}

/** The synced deposits do not rebuild the pool's on-chain tree. */
export class PoolVerificationError extends Error {
  override name = 'PoolVerificationError';
}

/** More leaves than this are hashed by a full (parallel) tree build instead of one at a time. */
const MAX_APPENDED_LEAVES = 256;

export interface IVerifyPoolLeavesAtParams {
  dataService: IDataService;
  poolAddress: Address;
  /** Every deposit the pool's tree holds after the sync, in any order. */
  deposits: Iterable<IRawDepositEvent>;
  /** The block the deposits are synced up to; the pool is read at it. */
  blockNumber: bigint;
  /** The frontier over the pool's first leaves, which are assumed to be the deposits' first ones. */
  frontier?: IMerkleFrontier;
  /** The frontier returned covers the deposits from before this block. */
  frontierBlock: bigint;
}

export interface IVerifiedPoolLeaves {
  /** The pool's root at `blockNumber`, which the deposits rebuild. */
  root: bigint;
  /** The frontier over the deposits from before `frontierBlock`, for the next sync to resume from. */
  frontier: IMerkleFrontier;
}

// Appends leaves one at a time when there are few, otherwise rebuilds them all in parallel.
async function extendFrontier(frontier: IMerkleFrontier | undefined, leaves: bigint[], size: number) {
  if (frontier && frontier.size <= size && size - frontier.size <= MAX_APPENDED_LEAVES) {
    return appendLeaves(frontier, leaves.slice(frontier.size, size));
  }

  return frontierOf(await buildTree(leaves.slice(0, size)));
}

/**
 * Verifies that `deposits` rebuild the pool's tree as it is at `blockNumber`:
 * gapless leaf indices, the pool's leaf count, and its getLastRoot() there.
 * Throws a {@link PoolVerificationError} on a mismatch.
 *
 * Exact equality at that block, not isKnownRoot(): a tree that is missing its
 * newest leaves still has a root in the recent history, so accepting one would
 * let a truncated event stream pass and the cursor move past what it left out.
 *
 * The tree is extended from `frontier` rather than rebuilt when it can be, so a
 * sync only hashes the leaves it scanned again. A wrong frontier fails the check
 * like a wrong leaf does.
 *
 * Only the leaves are checked. Withdrawals and deposit metadata (block,
 * timestamp, transaction) are not part of the tree and stay trusted to the
 * event source.
 */
export async function verifyPoolLeavesAt({
  dataService,
  poolAddress,
  deposits,
  blockNumber,
  frontier,
  frontierBlock,
}: IVerifyPoolLeavesAtParams): Promise<IVerifiedPoolLeaves> {
  const sorted = [...deposits].sort((a, b) => a.leafIndex - b.leafIndex);

  sorted.forEach(({ leafIndex }, index) => {
    if (leafIndex !== index) {
      throw new PoolVerificationError(
        `Pool ${poolAddress} leaves are not contiguous: leaf ${index} is missing ` +
        `(${sorted.length} leaves synced)`
      );
    }
  });

  const [leafCount, onchainRoot] = await Promise.all([
    dataService.getPoolLeafCount(poolAddress, blockNumber),
    dataService.getPoolStateRoot(poolAddress, blockNumber),
  ]);

  // Checked before hashing: a truncated stream fails without the cost.
  if (leafCount !== sorted.length) {
    throw new PoolVerificationError(
      `Pool ${poolAddress} holds ${leafCount} leaves at block ${blockNumber}, but ${sorted.length} were synced`
    );
  }

  // An empty pool's root is the contract's initial one, which is not the empty
  // tree's root; its leaf count already matched.
  if (sorted.length === 0) {
    return { root: onchainRoot, frontier: emptyFrontier() };
  }

  const leaves = sorted.map(({ commitment }) => commitment);
  const cut = sorted.findIndex(({ blockNumber }) => blockNumber >= frontierBlock);
  const resumed = await extendFrontier(frontier, leaves, cut === -1 ? leaves.length : cut);
  const { root: localRoot } = await extendFrontier(resumed, leaves, leaves.length);

  if (localRoot !== onchainRoot) {
    throw new PoolVerificationError(
      'State root verification failed: root does not match the Pool root at the synced block ' +
      `(pool=${poolAddress}, expected=${localRoot}, onChain=${onchainRoot}, block=${blockNumber})`
    );
  }

  return { root: onchainRoot, frontier: resumed };
}

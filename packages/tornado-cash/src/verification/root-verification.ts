import { buildTree } from '#merkle-tree';
import { IDataService } from '../data/interfaces/data.service.interface.js';
import { Address, Commitment } from '../interfaces/types.interface.js';

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

export interface IVerifyPoolLeavesAtBlockParams {
  dataService: IDataService;
  poolAddress: Address;
  /** Every deposit the pool would hold once the synced events are stored. */
  deposits: Iterable<{ commitment: Commitment; leafIndex: number }>;
  /** The block the deposits are synced up to; the Pool is read at it. */
  blockNumber: bigint;
}

/**
 * Verifies that `deposits` are exactly the Pool's tree at `blockNumber`, the
 * block they were synced up to, before they are stored.
 *
 * Exact equality with getLastRoot() at that block, not the contract's
 * isKnownRoot(): a tree missing its newest leaves still has a root in the
 * recent history, so accepting one would let a truncated event stream pass and
 * the pool's sync point move past the leaves it left out.
 *
 * An empty tree is checked through nextIndex(): Tornado versions differ on the
 * initial root, but an empty Pool's leaf count is always 0.
 */
export async function verifyPoolLeavesAtBlock({
  dataService,
  poolAddress,
  deposits,
  blockNumber,
}: IVerifyPoolLeavesAtBlockParams): Promise<void> {
  const sorted = Array.from(deposits).sort((a, b) => a.leafIndex - b.leafIndex);

  // Deposited leaf indices are 0-based and gapless on-chain. A hole or a
  // repeated index means the source dropped or forged events, which the root
  // check would only report as a mismatch.
  sorted.forEach(({ leafIndex }, index) => {
    if (leafIndex !== index) {
      throw new Error(
        `Pool ${poolAddress} leaves are not contiguous: expected leaf ${index}, found ${leafIndex} ` +
        `(${sorted.length} leaves)`
      );
    }
  });

  if (sorted.length === 0) {
    const onchainCount = await dataService.getPoolNextIndex(poolAddress, blockNumber);

    if (onchainCount !== 0) {
      throw new Error(
        `State root verification failed: no leaves synced but Pool holds ${onchainCount} at block ${blockNumber}`
      );
    }

    return;
  }

  const [{ root }, onchainRoot] = await Promise.all([
    buildTree(sorted.map(({ commitment }) => commitment)),
    dataService.getPoolStateRoot(poolAddress, blockNumber),
  ]);
  const expectedRoot = BigInt(root);

  if (onchainRoot !== expectedRoot) {
    throw new Error(
      'State root verification failed: root does not match Pool getLastRoot at the synced block ' +
      `(expected=${expectedRoot}, onChain=${onchainRoot}, block=${blockNumber})`
    );
  }
}

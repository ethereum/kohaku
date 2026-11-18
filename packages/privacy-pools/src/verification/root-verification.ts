import { IDataService } from '../data/interfaces/data.service.interface.js';
import { Address } from '../interfaces/types.interface.js';

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
 * Verifies that the state tree root is the Pool's currentRoot() at `blockNumber`,
 * the block the leaves were synced up to.
 *
 * Exact equality at that block, not the contract's _isKnownRoot(): a tree that
 * is missing its newest leaves still has a root in the recent history, so
 * accepting one would let a truncated leaf stream pass and the sync point move
 * past the leaves it left out.
 *
 * An empty tree (0n) is checked too: an empty Pool's currentRoot() is 0, so a
 * stream that dropped every leaf still fails.
 */
export async function verifyStateRootOnChain(
  dataService: IDataService,
  poolAddress: Address,
  expectedRoot: bigint,
  blockNumber: bigint,
): Promise<void> {
  const onchainRoot = await dataService.getPoolStateRoot(poolAddress, blockNumber);

  if (onchainRoot === expectedRoot) {
    return;
  }

  throw new Error(
    'State root verification failed: root does not match Pool currentRoot at the synced block ' +
    `(expected=${expectedRoot}, onChain=${onchainRoot}, block=${blockNumber})`
  );
}

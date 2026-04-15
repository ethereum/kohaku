import { IDataService } from '../data/interfaces/data.service.interface.js';
import { Address } from '../interfaces/types.interface.js';

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

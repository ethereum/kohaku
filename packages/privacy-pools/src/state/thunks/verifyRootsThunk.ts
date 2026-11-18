import type { MerkleTreeBuilder } from "../../utils/proof.util";
import { createAsyncThunk } from '@reduxjs/toolkit';
import { IDataService } from '../../data/interfaces/data.service.interface.js';
import {
  verifyAspRootOnChain,
  verifyStateRootOnChain,
} from '../../verification/root-verification.js';
import { aspLeavesRootSelector } from '../selectors/merkle.selector.js';
import { poolMerkleTreeRootSelector } from '../selectors/pools.selector.js';
import { entrypointInfoSelector, poolsLeavesSelector, poolsSelector } from '../selectors/slices.selectors.js';
import { setVerifiedAspRoot } from '../slices/aspVerificationSlice.js';
import { RootState } from '../store.js';
import { Address } from '../../interfaces/types.interface.js';

export interface VerifyRootsThunkParams {
  dataService: IDataService;
  /** The block the pool leaves are synced up to; pool roots are read at it. */
  blockNumber: bigint;
  /** Pass false to check only the pools, leaving the verified ASP root unset. */
  verifyAspRoot?: boolean;
  merkleTreeBuilder?: MerkleTreeBuilder;
}

export const verifyRootsThunk = createAsyncThunk<void, VerifyRootsThunkParams, { state: RootState }>(
  'sync/verifyRoots',
  async ({ dataService, blockNumber, verifyAspRoot = true, merkleTreeBuilder }, { getState, dispatch }) => {
    const state = getState();

    // Proofs may only use an ASP root this session matched to the chain, so the
    // previous one is dropped until the check below passes again.
    dispatch(setVerifiedAspRoot(0n));
    const { entrypointAddress } = entrypointInfoSelector(state);
    // Rebuilt from the synced leaves: the stored root is only what the service claimed.
    const aspRoot = verifyAspRoot ? await aspLeavesRootSelector(state, merkleTreeBuilder) : 0n;
    const pools = poolsSelector(state);
    const poolsLeaves = poolsLeavesSelector(state);


    // Compute every leaf-bearing pool's local root (CPU-bound), collecting the
    // on-chain checks to run together afterwards.
    const stateRootChecks: Array<{ poolAddress: Address; localRoot: bigint }> = [];

    for (const [poolAddress] of pools) {
      const leavesMap = poolsLeaves.get(poolAddress);

      if (!leavesMap || leavesMap.size === 0) continue;

      // LeafInserted indices are 1-based and gapless on-chain. A hole means the
      // source dropped events, which the root check would only report as a mismatch.
      for (let index = 1n; index <= BigInt(leavesMap.size); index++) {
        if (!leavesMap.has(index)) {
          throw new Error(
            `Pool ${poolAddress} leaves are not contiguous: leaf ${index} is missing ` +
            `(${leavesMap.size} leaves stored)`
          );
        }
      }

      const localRoot = await poolMerkleTreeRootSelector(state, poolAddress, merkleTreeBuilder);

      stateRootChecks.push({ poolAddress, localRoot });
    }


    // The Entrypoint ASP check and every pool state-root check are independent
    // reads — run them concurrently instead of awaiting one at a time.
    await Promise.all([
      ...(aspRoot !== 0n
        ? [verifyAspRootOnChain(dataService, entrypointAddress, aspRoot)
          .then(() => { dispatch(setVerifiedAspRoot(aspRoot)); })]
        : []),
      ...stateRootChecks.map(({ poolAddress, localRoot }) =>
        verifyStateRootOnChain(dataService, poolAddress, localRoot, blockNumber)),
    ]);
  }
);

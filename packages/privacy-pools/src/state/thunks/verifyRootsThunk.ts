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
  /** The block the pool leaves and RootUpdated events are synced up to; every root is read at it. */
  blockNumber: bigint;
  /** Pass false to check only the pools, leaving the verified ASP root unset. */
  verifyAspRoot?: boolean;
  /** Pass false to check only the ASP root, when no pool leaves were synced. */
  verifyPoolRoots?: boolean;
  merkleTreeBuilder?: MerkleTreeBuilder;
}

export const verifyRootsThunk = createAsyncThunk<void, VerifyRootsThunkParams, { state: RootState }>(
  'sync/verifyRoots',
  async ({ dataService, blockNumber, verifyAspRoot = true, verifyPoolRoots = true, merkleTreeBuilder }, { getState, dispatch }) => {
    const state = getState();

    // Proofs may only use an ASP root this session matched to the chain, so the
    // previous one is dropped until the check below passes again.
    dispatch(setVerifiedAspRoot(0n));
    const { entrypointAddress } = entrypointInfoSelector(state);
    // Rebuilt from the synced leaves: the stored root is only what the service claimed.
    const aspRoot = verifyAspRoot ? await aspLeavesRootSelector(state, merkleTreeBuilder) : 0n;
    const pools = verifyPoolRoots ? poolsSelector(state) : new Map();
    const poolsLeaves = poolsLeavesSelector(state);


    // Compute every pool's local root (CPU-bound), collecting the on-chain checks
    // to run together afterwards. A pool with no stored leaves is checked as an
    // empty tree, so a stream that dropped all of them cannot pass unread.
    const stateRootChecks: Array<{ poolAddress: Address; localRoot: bigint }> = [];

    for (const [poolAddress] of pools) {
      const leavesMap = poolsLeaves.get(poolAddress) ?? new Map();

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

      // An empty LeanIMT's root is 0, which is what an empty Pool's currentRoot() returns.
      const localRoot = leavesMap.size === 0
        ? 0n
        : await poolMerkleTreeRootSelector(state, poolAddress, merkleTreeBuilder);

      stateRootChecks.push({ poolAddress, localRoot });
    }


    // The Entrypoint ASP check and every pool state-root check are independent
    // reads — run them concurrently instead of awaiting one at a time.
    await Promise.all([
      ...(aspRoot !== 0n
        ? [verifyAspRootOnChain(dataService, entrypointAddress, aspRoot, blockNumber)
          .then(() => { dispatch(setVerifiedAspRoot(aspRoot)); })]
        : []),
      ...stateRootChecks.map(({ poolAddress, localRoot }) =>
        verifyStateRootOnChain(dataService, poolAddress, localRoot, blockNumber)),
    ]);
  }
);

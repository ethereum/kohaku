import { createAsyncThunk } from '@reduxjs/toolkit';
import { IAspService } from '../../data/asp.interface.js';
import { computeMerkleTreeRoot, SNARK_SCALAR_FIELD } from '../../utils/proof.util';
import { isAspRootUpToDateSelector } from '../selectors/asp.selector';
import { aspLeavesRootSelector } from '../selectors/merkle.selector';
import { registerAspTree } from '../slices/aspSlice';
import { RootState } from '../store';
import { lastUpdateRootEventSelector } from '../selectors/slices.selectors';

export interface SyncAspThunkParams {
  aspService: IAspService;
}

/**
 * The ASP service is untrusted (the default one reads whatever an IPFS gateway
 * serves). Only its leaves are kept, and the root is rebuilt from them, so it
 * cannot add or drop a label without missing the root the Entrypoint emitted.
 * The root does not commit to the leaf count, though: a service can still pass
 * an upper level of the real tree off as its leaves, which hides every label.
 */
const checkedLeaves = async (aspTree: bigint[][], expectedRoot: bigint): Promise<bigint[]> => {
  const leaves = aspTree.at(0) ?? [];

  // Poseidon reduces its inputs, so `label + p` would build the same root while
  // no longer matching the label.
  if (leaves.some((leaf) => typeof leaf !== 'bigint' || leaf < 0n || leaf >= SNARK_SCALAR_FIELD)) {
    throw new Error('ASP tree rejected: a leaf is not a SNARK field element');
  }

  const root = leaves.length > 0 ? await computeMerkleTreeRoot(leaves) : 0n;

  if (root !== expectedRoot) {
    throw new Error(
      'ASP tree root mismatch: the root rebuilt from the leaves does not match the RootUpdated root ' +
      `(rebuilt=${root}, event=${expectedRoot})`,
    );
  }

  return leaves;
};

export const syncAspThunk = createAsyncThunk<void, SyncAspThunkParams, { state: RootState }>(
  'sync/asp',
  async ({ aspService }, { getState, dispatch }) => {
    const state = getState();
    const lastUpdateRootEvent = lastUpdateRootEventSelector(state);

    if (!lastUpdateRootEvent) {
      return;
    }

    // Stored leaves are re-checked too: a state saved by an older version, or a
    // shared snapshot, may hold leaves that do not build the root stored with them.
    if (isAspRootUpToDateSelector(state) && await aspLeavesRootSelector(state) === lastUpdateRootEvent.root) {
      return;
    }

    const leaves = await checkedLeaves(await aspService.getAspTree(state), lastUpdateRootEvent.root);

    dispatch(registerAspTree({
      leaves,
      aspTreeRoot: lastUpdateRootEvent.root,
      blockNumber: lastUpdateRootEvent.blockNumber,
    }));
  }
);

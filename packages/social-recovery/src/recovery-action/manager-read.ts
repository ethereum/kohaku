import { encodeFunctionData } from 'viem';
import { RECOVERY_ACTION_MANAGER_ABI, RECOVERY_ACTION_READ_FROM } from '../constants';
import { normalizeAddress } from '../formats/guards';
import { isProviderRevert, type Address, type BlockTag, type IProvider, type ReadResult } from '../interfaces';
import { decodeReturn } from '../policy-manager/chain';

/** One `MANAGER()` call to the action; a revert answers `undefined`, any other rejection propagates as itself. */
async function managerCall(provider: IProvider, action: Address, at: BlockTag): Promise<unknown> {
  try {
    return await provider.call(action, encodeFunctionData({ abi: RECOVERY_ACTION_MANAGER_ABI }), RECOVERY_ACTION_READ_FROM, at);
  } catch (thrown) {
    if (isProviderRevert(thrown)) return undefined;

    throw thrown;
  }
}

/** The action's `MANAGER()` answer at the block, checksummed; unanswered where the call reverts or its bytes do not decode. */
export async function actionManagerAt(provider: IProvider, action: Address, at: BlockTag): Promise<ReadResult<Address>> {
  const returned = await managerCall(provider, action, at);
  let manager: Address;

  try {
    [manager] = decodeReturn(RECOVERY_ACTION_MANAGER_ABI[0].outputs, returned, 'MANAGER');
  } catch {
    return { answered: false };
  }

  return { answered: true, value: normalizeAddress(manager, 'MANAGER') };
}

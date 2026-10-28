import { decodeAbiParameters, encodeAbiParameters, type AbiParameter, type DecodeAbiParametersReturnType } from 'viem';
import { FORMATS_HEX_BYTES_PATTERN, POLICY_MANAGER_READ_FROM } from '../constants';
import { pinBlockHeader } from '../client-core/block';
import { assertBytes, checkedBlock, lowerHex } from '../formats/guards';
import { decodeStrictly } from '../formats/strict';
import { isProviderRevert, type Address, type BlockTag, type Hex, type IProvider, type PinnedBlock } from '../interfaces';
import type { CallOutcome } from '../types/policy-manager';

/** The block the tag names at this moment, read once through `pinBlockHeader`, without its timestamp. */
export async function pinBlock(provider: IProvider, tag: BlockTag): Promise<PinnedBlock> {
  return (await pinBlockHeader(provider, tag)).block;
}

/** The passed block, checked before any provider call, where one was passed; else the read tag's block read once. */
export const resolveBlock = (provider: IProvider, tag: BlockTag, block: PinnedBlock | undefined): Promise<PinnedBlock> =>
  block === undefined ? pinBlock(provider, tag) : Promise.resolve(checkedBlock(block, 'block'));

/** One view call at the pinned block; a revert and a transport failure reject as the provider rejected. */
export const readCall = (provider: IProvider, to: Address, data: Hex, block: PinnedBlock): Promise<Hex> =>
  provider.call(to, data, POLICY_MANAGER_READ_FROM, block.number);

/** One view call to a module, telling a contract that returned or reverted from a provider that failed. */
export async function moduleCall(provider: IProvider, to: Address, data: Hex, block: PinnedBlock): Promise<CallOutcome> {
  let returned: unknown;

  try {
    returned = await readCall(provider, to, data, block);
  } catch (thrown) {
    return isProviderRevert(thrown) ? { kind: 'reverted' } : { kind: 'failed' };
  }

  if (typeof returned !== 'string' || !FORMATS_HEX_BYTES_PATTERN.test(returned)) return { kind: 'failed' };

  return { kind: 'returned', data: lowerHex(returned as Hex) };
}

/**
 * Decodes a view's return: bytes that are not hex throw a `TypeError`, and bytes that do not decode
 * or are not the canonical encoding the decoded values re-encode to throw a `RangeError`.
 */
export function decodeReturn<const Params extends readonly AbiParameter[]>(
  params: Params,
  returned: unknown,
  view: string,
): DecodeAbiParametersReturnType<Params> {
  assertBytes(returned, view);

  return decodeStrictly(returned, view, `the return of ${view}`, {
    decode: (bytes) => decodeAbiParameters(params, bytes),
    build: (decoded) => decoded,
    encode: (decoded) => {
      // A decoded value the encoder refuses is not a canonical return, so it fails the comparison.
      try {
        return encodeAbiParameters(params, decoded as never);
      } catch {
        return '0x';
      }
    },
  });
}

/** The decoded return, or nothing where the module reverted or returned bytes that do not decode. */
export function decodeModuleReturn<const Params extends readonly AbiParameter[]>(
  params: Params,
  outcome: CallOutcome,
  view: string,
): DecodeAbiParametersReturnType<Params> | undefined {
  if (outcome.kind !== 'returned') return undefined;

  try {
    return decodeReturn(params, outcome.data, view);
  } catch {
    return undefined;
  }
}

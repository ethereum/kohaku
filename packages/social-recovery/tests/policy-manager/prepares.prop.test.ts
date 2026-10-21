import fc from 'fast-check';
import { decodeFunctionData, getAddress, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Address, Hex } from '../../src/index';
import { TIMEOUT, address, anyBytes, bytesN, uint } from '../formats/arbitraries';
import { ProviderDouble } from './double';
import { MANAGER, partFor } from './fixtures';
import { runAsync } from './runs';

/** The manager's four plain writes, parsed by viem from hand-written declarations. */
const WRITES_ABI = parseAbi([
  'function commitSetup(address action, bytes32 setupCommitment, uint64 nonce, bytes publicMetadata, bytes privateMetadata)',
  'function clearSetup(address action, uint64 nonce)',
  'function cancelByOwner(address action, uint64 attemptId)',
  'function cancelByVeto(address account, address action, uint64 attemptId, address method)',
]);

/** An address in one of the three spellings the address rule accepts. */
const spelled = address.chain((raw) =>
  fc.constantFrom<Address>(raw.toLowerCase() as Address, `0x${raw.slice(2).toUpperCase()}`, getAddress(raw)).map((spelling) => ({ raw, spelling })),
);

const decoded = (data: Hex) => decodeFunctionData({ abi: WRITES_ABI, data });

describe('each prepare decodes back to its arguments', () => {
  it('prepareCommitSetup round-trips every in-width argument, hex lower-cased', async () => {
    await runAsync(
      fc.asyncProperty(spelled, bytesN(32), uint(64), anyBytes, anyBytes, async (action, commitment, nonce, pub, priv) => {
        const upper = (hex: Hex): Hex => `0x${hex.slice(2).toUpperCase()}`;
        const call = await partFor(new ProviderDouble(), MANAGER, action.spelling).prepareCommitSetup(action.spelling, upper(commitment), nonce, upper(pub), priv);

        expect(decoded(call.data)).toEqual({ functionName: 'commitSetup', args: [getAddress(action.raw), commitment, nonce, pub, priv] });
        expect(call.sender).toBe('account');
      }),
    );
  }, TIMEOUT);

  it('prepareCancelByVeto round-trips every in-width argument', async () => {
    await runAsync(
      fc.asyncProperty(spelled, spelled, uint(64), spelled, async (account, action, attemptId, method) => {
        const call = await partFor(new ProviderDouble(), account.spelling, action.spelling).prepareCancelByVeto(
          account.spelling,
          action.spelling,
          attemptId,
          method.spelling,
        );

        expect(decoded(call.data)).toEqual({
          functionName: 'cancelByVeto',
          args: [getAddress(account.raw), getAddress(action.raw), attemptId, getAddress(method.raw)],
        });
        expect(call.sender).toBe('anyone');
      }),
    );
  }, TIMEOUT);

  it('prepareClearSetup and prepareCancelByOwner round-trip the bound action and every in-width second word', async () => {
    await runAsync(
      fc.asyncProperty(spelled, fc.constantFrom('prepareClearSetup', 'prepareCancelByOwner'), uint(64), async (action, member, second) => {
        const call = await partFor(new ProviderDouble(), MANAGER, action.spelling)[member](action.spelling, second);

        expect(decoded(call.data)).toEqual({
          functionName: member === 'prepareClearSetup' ? 'clearSetup' : 'cancelByOwner',
          args: [getAddress(action.raw), second],
        });
        expect(call.sender).toBe('account');
      }),
    );
  }, TIMEOUT);

  it('refuses every nonce and attempt id at or beyond 2^64', async () => {
    await runAsync(
      fc.asyncProperty(fc.bigInt({ min: 1n << 64n, max: 1n << 256n }), async (wide) => {
        const part = partFor(new ProviderDouble(), MANAGER, MANAGER);

        await expect(part.prepareCommitSetup(MANAGER, `0x${'11'.repeat(32)}`, wide, '0x', '0x')).rejects.toThrow();
        await expect(part.prepareCancelByVeto(MANAGER, MANAGER, wide, MANAGER)).rejects.toThrow();
        await expect(part.prepareClearSetup(MANAGER, wide)).rejects.toThrow(RangeError);
        await expect(part.prepareCancelByOwner(MANAGER, wide)).rejects.toThrow(RangeError);
      }),
    );
  }, TIMEOUT);
});

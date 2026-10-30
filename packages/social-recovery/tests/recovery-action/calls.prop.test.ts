import fc from 'fast-check';
import { decodeFunctionData, encodeAbiParameters, getAddress, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, AmbireRecoveryAction, kitBinding, kitSlot, type Address, type Hex } from '../../src/index';
import { address, TIMEOUT } from '../formats/arbitraries';
import { keccak256 } from '../helpers/keccak';
import { ACCOUNT, ACTION, BLOCK_TAGS, DESCRIPTOR, SELECTORS } from './fixtures';
import { providerDouble } from './provider-double';

const RUNS = { numRuns: Number(process.env['FC_NUM_RUNS'] ?? 256) };

const ACCOUNT_ABI = parseAbi(['function setAddrPrivilege(address addr, bytes32 priv) payable']);

const hash = (hex: Hex): Hex => keccak256(Uint8Array.from(Buffer.from(hex.slice(2), 'hex'))) as Hex;

/** The kit slot recomputed here: the low 20 bytes of keccak256(abi.encode("kit", action)). */
const slotOf = (action: Address): Address =>
  getAddress(`0x${hash(encodeAbiParameters([{ type: 'string' }, { type: 'address' }], ['kit', action])).slice(-40)}`);

/** The binding recomputed here: keccak256(abi.encode(action, bytes(""))). */
const bindingOf = (action: Address): Hex => hash(encodeAbiParameters([{ type: 'address' }, { type: 'bytes' }], [action, '0x']));

const partFor = (account: Address, action: Address) =>
  new AmbireRecoveryAction(providerDouble().provider, DESCRIPTOR, account, action, new AmbireActionCodec([action]), BLOCK_TAGS);

describe('the privilege calls for any action', () => {
  it('armingCall decodes to setAddrPrivilege(kitSlot(a), kitBinding(a)) on the account', async () => {
    await fc.assert(
      fc.asyncProperty(address, address, async (account, action) => {
        const call = await partFor(account, action).armingCall();
        const decoded = decodeFunctionData({ abi: ACCOUNT_ABI, data: call.data });

        expect(decoded.args).toEqual([slotOf(action), bindingOf(action)]);
        expect(decoded.args).toEqual([kitSlot(action), kitBinding(action)]);
        expect(call.target).toBe(getAddress(account));
        expect(call.sender).toBe('account');
        expect(call.value).toBe(0n);
      }),
      RUNS,
    );
  }, TIMEOUT);

  it('disarmingCall decodes to setAddrPrivilege(kitSlot(a), 0) on the account', async () => {
    await fc.assert(
      fc.asyncProperty(address, address, async (account, action) => {
        const call = await partFor(account, action).disarmingCall();
        const decoded = decodeFunctionData({ abi: ACCOUNT_ABI, data: call.data });

        expect(decoded.args).toEqual([slotOf(action), `0x${'0'.repeat(64)}`]);
        expect(call.target).toBe(getAddress(account));
      }),
      RUNS,
    );
  }, TIMEOUT);
});

describe('the bool views for any word', () => {
  it('answer only words 0 and 1 and throw on every other word', async () => {
    const words = fc.oneof(fc.constantFrom(0n, 1n), fc.bigInt({ min: 2n, max: (1n << 256n) - 1n }));

    await fc.assert(
      fc.asyncProperty(words, async (value) => {
        const returns: Hex = `0x${value.toString(16).padStart(64, '0')}`;
        const double = providerDouble({ [SELECTORS.isAuthorized]: { returns } });
        const part = new AmbireRecoveryAction(double.provider, DESCRIPTOR, ACCOUNT, ACTION, new AmbireActionCodec([ACTION]), BLOCK_TAGS);

        if (value <= 1n) await expect(part.isAuthorized()).resolves.toBe(value === 1n);
        else await expect(part.isAuthorized()).rejects.toThrow();
      }),
      RUNS,
    );
  }, TIMEOUT);
});

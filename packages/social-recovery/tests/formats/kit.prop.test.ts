import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { kitBinding, kitSlot } from '../../src/index';
import { address, run, TIMEOUT } from './arbitraries';
import { kitBindingPreimage, kitSlotPreimage } from './request-support';
import { keccakLocal } from './support';

describe('kit slot and binding', () => {
  it('kitSlot is the low twenty bytes of the slot hash, checksummed', () => {
    run(
      fc.property(address, (action) => {
        const slotHash = keccakLocal(kitSlotPreimage(action));

        expect(kitSlot(action)).toBe(getAddress(`0x${slotHash.slice(26)}`));
      }),
    );
  }, TIMEOUT);

  it('kitBinding is the hash of abi.encode(action, empty bytes)', () => {
    run(
      fc.property(address, (action) => {
        expect(kitBinding(action)).toBe(keccakLocal(kitBindingPreimage(action)));
      }),
    );
  }, TIMEOUT);
});

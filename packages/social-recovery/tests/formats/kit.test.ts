import { encodeAbiParameters, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { kitBinding, kitSlot, type Hex } from '../../src/index';
import { kitBindingPreimage, kitSlotPreimage, oracleKitSlot } from './request-support';
import { AN_ACTION, keccakLocal, ZERO_ADDRESS } from './support';

const CHECKSUMMED = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const BAD_CHECKSUM = '0x8Ba1f109551bD432803012645Ac136ddd64DBA72';

describe('kitSlot', () => {
  it('is the low twenty bytes of keccak256(abi.encode("kit", action)), checksummed', () => {
    const slot = kitSlot(AN_ACTION);

    expect(slot).toBe(oracleKitSlot(AN_ACTION));
    expect(slot).toBe(getAddress('0xb64cddd1b613c46e97677526c0cd0115cf105553'));
    expect(slot).toBe(getAddress(slot));
  });

  it('hashes abi.encode of the string literal and the action, never the packed form', () => {
    const packed = keccakLocal(`0x${Buffer.from('kit').toString('hex')}${AN_ACTION.slice(2)}`);

    expect(kitSlotPreimage(AN_ACTION)).toBe(encodeAbiParameters([{ type: 'string' }, { type: 'address' }], ['kit', AN_ACTION]));
    expect(kitSlot(AN_ACTION).toLowerCase()).not.toBe(`0x${packed.slice(-40)}`);
  });

  it('differs per action and holds for the zero action', () => {
    expect(kitSlot(CHECKSUMMED)).not.toBe(kitSlot(AN_ACTION));
    expect(kitSlot(ZERO_ADDRESS)).toBe(oracleKitSlot(ZERO_ADDRESS));
  });

  it('accepts every valid spelling of the action alike and refuses a wrong checksum', () => {
    const expected = kitSlot(CHECKSUMMED);

    expect(kitSlot(CHECKSUMMED.toLowerCase() as Hex)).toBe(expected);
    expect(kitSlot(`0x${CHECKSUMMED.slice(2).toUpperCase()}`)).toBe(expected);
    expect(() => kitSlot(BAD_CHECKSUM)).toThrow();
    expect(() => kitSlot('0x1234')).toThrow();
  });
});

describe('kitBinding', () => {
  it('is keccak256(abi.encode(action, bytes("")))', () => {
    expect(kitBinding(AN_ACTION)).toBe(keccakLocal(kitBindingPreimage(AN_ACTION)));
    expect(kitBinding(AN_ACTION)).toBe('0x91c0bf1b366947b9cb85e75de0b7d50a35a8d08e1cca0997e5317f30c566029f');
  });

  it('is not the packed or the bare hash of the action', () => {
    expect(kitBinding(AN_ACTION)).not.toBe(keccakLocal(AN_ACTION));
    expect(kitBinding(AN_ACTION)).not.toBe(keccakLocal(kitBindingPreimage(AN_ACTION).slice(0, 66)));
  });

  it('accepts every valid spelling alike and refuses a wrong checksum', () => {
    expect(kitBinding(CHECKSUMMED.toLowerCase() as Hex)).toBe(kitBinding(CHECKSUMMED));
    expect(kitBinding(`0x${CHECKSUMMED.slice(2).toUpperCase()}`)).toBe(kitBinding(CHECKSUMMED));
    expect(() => kitBinding(BAD_CHECKSUM)).toThrow();
  });
});

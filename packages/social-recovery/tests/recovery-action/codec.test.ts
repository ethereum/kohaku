import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, describeRequest, type Address, type ApproverRequest, type Handover, type Hex } from '../../src/index';
import { approvalFromVector, codecRegistry, methodRegistry } from '../description/request-fixtures';
import { keccak256 } from '../helpers/keccak';
import { readVector, type VectorRow } from '../kat/read-vector';
import { ACTION, CANDIDATE, KEY, OTHER_ACTION, word, ZERO } from './fixtures';

const rows = readVector('ambire-handover.json').vectors;

const row = (name: string): VectorRow => {
  const found = rows.find((candidate) => candidate['id'] === name);

  if (found === undefined) throw new Error(`ambire-handover has no ${name} row`);

  return found;
};

const field = (source: unknown, key: string): string => {
  const value = (source as Record<string, unknown>)[key];

  if (typeof value !== 'string') throw new Error(`vector row lacks ${key}`);

  return value;
};

const normal = row('normal');
const trailing = row('trailing-byte');
const codec = new AmbireActionCodec([ACTION]);
const pair = (first: string, second: string): Hex => `0x${word(first)}${word(second)}`;
const canonical = pair(KEY, CANDIDATE);
const hexBytes = (hex: Hex): Uint8Array => Uint8Array.from(Buffer.from(hex.slice(2), 'hex'));

/** A mixed-case spelling of a valid address whose EIP-55 checksum fails. */
const badChecksum = (address: Address): Address => {
  const good = getAddress(address);
  const flipped = good.slice(2).replace(/[a-f]/, (letter) => letter.toUpperCase());

  return `0x${flipped === good.slice(2) ? good.slice(2).replace(/[A-F]/, (letter) => letter.toLowerCase()) : flipped}`;
};

describe('AmbireActionCodec over the blessed handover rows', () => {
  it('encodes the normal row byte for byte and hashes to its payload hash', () => {
    const encoded = codec.encode({
      newAuthority: field(normal.input, 'newAuthority') as Address,
      removedAuthority: field(normal.input, 'removedAuthority') as Address,
    });

    expect(encoded).toBe(field(normal.expected, 'encoded'));
    expect(keccak256(hexBytes(encoded))).toBe(field(normal.expected, 'payloadHash'));
  });

  it('decodes the normal row to its two addresses, checksummed', () => {
    expect(codec.decode(field(normal.expected, 'encoded') as Hex)).toEqual({
      newAuthority: getAddress(field(normal.input, 'newAuthority')),
      removedAuthority: getAddress(field(normal.input, 'removedAuthority')),
    });
  });

  it('refuses the trailing-byte row', () => {
    expect(() => codec.decode(field(trailing.input, 'encoded') as Hex)).toThrow();
  });
});

describe('AmbireActionCodec.decode judges the layout', () => {
  it('refuses 63 and 65 bytes', () => {
    expect(() => codec.decode(canonical.slice(0, -2) as Hex)).toThrow();
    expect(() => codec.decode(`${canonical}00`)).toThrow();
  });

  it('refuses empty, one-word and three-word payloads', () => {
    expect(() => codec.decode('0x')).toThrow();
    expect(() => codec.decode(`0x${word(KEY)}`)).toThrow();
    expect(() => codec.decode(`${canonical}${word('0')}`)).toThrow();
  });

  it.each(Array.from({ length: 12 }, (_, index) => index))('refuses a nonzero byte at padding offset %i of either word', (offset) => {
    const body = canonical.slice(2);
    const at = (start: number): Hex => `0x${body.slice(0, start)}01${body.slice(start + 2)}`;

    expect(() => codec.decode(at(offset * 2))).toThrow();
    expect(() => codec.decode(at(64 + offset * 2))).toThrow();
  });

  it.each([
    ['no prefix', canonical.slice(2)],
    ['odd digits', `${canonical}0`],
    ['a non-hex digit', `0x${'g'}${canonical.slice(3)}`],
    ['a number', 7],
    ['undefined', undefined],
  ])('refuses %s', (_label, payload) => {
    expect(() => codec.decode(payload as Hex)).toThrow();
  });

  it('decodes upper-case hex to the same handover as lower-case', () => {
    const upper = `0x${canonical.slice(2).toUpperCase()}` as Hex;

    expect(codec.decode(upper)).toEqual(codec.decode(canonical));
    expect(codec.decode(canonical)).toEqual({ newAuthority: getAddress(KEY), removedAuthority: getAddress(CANDIDATE) });
  });

  it('accepts a canonical payload naming a zero address on either side', () => {
    expect(codec.decode(pair(ZERO, CANDIDATE))).toEqual({ newAuthority: ZERO, removedAuthority: getAddress(CANDIDATE) });
    expect(codec.decode(pair(KEY, ZERO))).toEqual({ newAuthority: getAddress(KEY), removedAuthority: ZERO });
    expect(codec.decode(pair(ZERO, ZERO))).toEqual({ newAuthority: ZERO, removedAuthority: ZERO });
  });

  it('accepts a canonical payload naming one address on both sides', () => {
    expect(codec.decode(pair(KEY, KEY))).toEqual({ newAuthority: getAddress(KEY), removedAuthority: getAddress(KEY) });
  });
});

describe('AmbireActionCodec.encode refuses a handover no approver should sign', () => {
  const refuses = (handover: Partial<Handover>) => () => codec.encode(handover as Handover);

  it('refuses a missing removed authority', () => {
    expect(refuses({ newAuthority: KEY })).toThrow();
  });

  it('refuses a mixed-case address whose checksum fails, on either side', () => {
    expect(refuses({ newAuthority: badChecksum(KEY.replace(/7/g, 'a') as Address), removedAuthority: CANDIDATE })).toThrow();
    expect(refuses({ newAuthority: KEY, removedAuthority: badChecksum(CANDIDATE.replace(/8/g, 'b') as Address) })).toThrow();
  });

  it('refuses a malformed address', () => {
    expect(refuses({ newAuthority: '0x1234', removedAuthority: CANDIDATE })).toThrow();
    expect(refuses({ newAuthority: KEY, removedAuthority: `${CANDIDATE}00` as Address })).toThrow();
  });

  it('refuses a zero address on either side', () => {
    expect(refuses({ newAuthority: ZERO, removedAuthority: CANDIDATE })).toThrow();
    expect(refuses({ newAuthority: KEY, removedAuthority: ZERO })).toThrow();
  });

  it('refuses one address on both sides, in any spelling', () => {
    const mixed = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

    expect(refuses({ newAuthority: KEY, removedAuthority: KEY })).toThrow();
    expect(refuses({ newAuthority: mixed, removedAuthority: mixed.toLowerCase() as Address })).toThrow();
  });

  it('accepts all-upper-case and checksummed spellings and encodes them alike', () => {
    const upper = `0x${CANDIDATE.slice(2).toUpperCase()}` as Address;
    const mixed = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

    expect(codec.encode({ newAuthority: KEY, removedAuthority: upper })).toBe(canonical);
    expect(codec.encode({ newAuthority: mixed, removedAuthority: CANDIDATE })).toBe(pair(mixed, CANDIDATE));
  });
});

describe('AmbireActionCodec.actions', () => {
  it('lists the served actions in order, checksummed', () => {
    const mixed = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

    expect(new AmbireActionCodec([mixed, OTHER_ACTION]).actions).toEqual([getAddress(mixed), getAddress(OTHER_ACTION)]);
  });

  it('refuses an empty list', () => {
    expect(() => new AmbireActionCodec([])).toThrow();
  });

  it('refuses a repeated address, also when spelled differently', () => {
    const mixed = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

    expect(() => new AmbireActionCodec([ACTION, ACTION])).toThrow();
    expect(() => new AmbireActionCodec([mixed, mixed.toLowerCase() as Address])).toThrow();
  });

  it('refuses a malformed or badly checksummed action', () => {
    expect(() => new AmbireActionCodec(['0x1234'])).toThrow();
    expect(() => new AmbireActionCodec([badChecksum('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')])).toThrow();
  });

  it('serves as a registry entry: a request description decodes a handover through it', () => {
    const request = { ...approvalFromVector(), payload: canonical } as ApproverRequest;
    const served = new AmbireActionCodec([request.action]);
    const description = describeRequest(request, codecRegistry(served), methodRegistry([]));

    expect(description.handover).toEqual({ decoded: true, newAuthority: getAddress(KEY), removedAuthority: getAddress(CANDIDATE) });
  });

  it('serves as a registry entry: a request description shows no handover for trailing bytes', () => {
    const request = { ...approvalFromVector(), payload: `${canonical}00` } as ApproverRequest;
    const description = describeRequest(request, codecRegistry(new AmbireActionCodec([request.action])), methodRegistry([]));

    expect(description.handover?.decoded).toBe(false);
  });
});

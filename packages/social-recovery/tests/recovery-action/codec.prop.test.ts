import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { AmbireActionCodec, type Address, type Handover, type Hex } from '../../src/index';
import { address, bytesN, run, TIMEOUT } from '../formats/arbitraries';
import { ACTION, word } from './fixtures';

const codec = new AmbireActionCodec([ACTION]);
const ZERO_BODY = '0'.repeat(40);

/** A nonzero address in lower case, upper case or its checksummed spelling. */
const spelled = address
  .filter((value) => value.slice(2) !== ZERO_BODY)
  .chain((value) =>
    fc.constantFrom<Address>(value, `0x${value.slice(2).toUpperCase()}`, getAddress(value)),
  );

const distinctPair = fc
  .tuple(spelled, spelled)
  .filter(([first, second]) => first.toLowerCase() !== second.toLowerCase());

const canonical = fc.tuple(address, address).map(([first, second]): Hex => `0x${word(first)}${word(second)}`);

/** One edit of a canonical payload: bytes appended, a byte dropped, or a padding byte set nonzero. */
const mutation = fc.oneof(
  fc.record({ kind: fc.constant('append' as const), extra: fc.integer({ min: 1, max: 40 }).chain((n) => bytesN(n)) }),
  fc.record({ kind: fc.constant('drop' as const), at: fc.integer({ min: 0, max: 63 }) }),
  fc.record({ kind: fc.constant('pad' as const), at: fc.integer({ min: 0, max: 23 }), byte: fc.integer({ min: 1, max: 255 }) }),
);

type Mutation = { kind: 'append'; extra: Hex } | { kind: 'drop'; at: number } | { kind: 'pad'; at: number; byte: number };

const apply = (payload: Hex, edit: Mutation): Hex => {
  const body = payload.slice(2);

  if (edit.kind === 'append') return `0x${body}${edit.extra.slice(2)}`;

  if (edit.kind === 'drop') return `0x${body.slice(0, edit.at * 2)}${body.slice(edit.at * 2 + 2)}`;

  const offset = edit.at < 12 ? edit.at : 32 + (edit.at - 12);

  return `0x${body.slice(0, offset * 2)}${edit.byte.toString(16).padStart(2, '0')}${body.slice(offset * 2 + 2)}`;
};

describe('AmbireActionCodec round trip', () => {
  it('decodes every encoded handover of two distinct nonzero addresses back to it, checksummed', () => {
    run(fc.property(distinctPair, ([newAuthority, removedAuthority]) => {
      const handover: Handover = { newAuthority, removedAuthority };
      const encoded = codec.encode(handover);

      expect(encoded).toBe(`0x${word(newAuthority)}${word(removedAuthority)}`);
      expect(codec.decode(encoded)).toEqual({ newAuthority: getAddress(newAuthority), removedAuthority: getAddress(removedAuthority) });
    }));
  }, TIMEOUT);

  it('never decodes a mutated payload to fields that re-encode to other bytes', () => {
    run(fc.property(canonical, mutation, (payload, edit) => {
      const mutated = apply(payload, edit as Mutation);
      let decoded: Handover | undefined;

      try {
        decoded = codec.decode(mutated);
      } catch {
        decoded = undefined;
      }

      if (decoded === undefined) return;

      expect(mutated.length).toBe(130);
      expect(`0x${word(decoded.newAuthority)}${word(decoded.removedAuthority ?? '')}`).toBe(mutated.toLowerCase());
    }));
  }, TIMEOUT);

  it('refuses every mutation that changes the length or the padding', () => {
    run(fc.property(canonical, mutation, (payload, edit) => {
      expect(() => codec.decode(apply(payload, edit as Mutation))).toThrow();
    }));
  }, TIMEOUT);
});

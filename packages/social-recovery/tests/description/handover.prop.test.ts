import fc from 'fast-check';
import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeRequest, type ApproverRequest, type Hex } from '../../src/index';
import { address, anyBytes, bytesN, TIMEOUT, run } from '../formats/arbitraries';
import { approvalFromVector, codecRegistry, lenientCodec, methodRegistry, strictCodec } from './request-fixtures';

const base = approvalFromVector();
const methods = methodRegistry([]);
const withPayload = (payload: Hex): ApproverRequest => ({ ...base, payload } as ApproverRequest);

/** Whether bytes are exactly two words, each a left-padded address: the only payloads the layout re-encodes to themselves. */
const canonicalPair = (payload: Hex): boolean => {
  const body = payload.slice(2).toLowerCase();

  return body.length === 128 && body.slice(0, 24) === '0'.repeat(24) && body.slice(64, 88) === '0'.repeat(24);
};

const padded = (value: Hex): string => value.slice(2).toLowerCase().padStart(64, '0');

describe('the handover round trip through a fixture codec', () => {
  it('decodes every encoded pair back to its two keys', () => {
    run(fc.property(address, address, (newAuthority, removedAuthority) => {
      const payload: Hex = `0x${padded(newAuthority)}${padded(removedAuthority)}`;
      const codecs = codecRegistry(strictCodec([base.action]));

      expect(describeRequest(withPayload(payload), codecs, methods).handover).toEqual({
        decoded: true,
        newAuthority: getAddress(newAuthority),
        removedAuthority: getAddress(removedAuthority),
      });
    }));
  }, TIMEOUT);

  it('shows keys only for bytes the layout re-encodes byte for byte, even through a lenient decoder', () => {
    const payloads = fc.oneof(anyBytes, bytesN(64), bytesN(65), fc.tuple(address, address).map(([a, b]): Hex => `0x${padded(a)}${padded(b)}`));

    run(fc.property(payloads, fc.boolean(), (payload, lenient) => {
      const codec = lenient ? lenientCodec([base.action]) : strictCodec([base.action]);
      const handover = describeRequest(withPayload(payload), codecRegistry(codec), methods).handover;

      expect(handover?.decoded).toBe(canonicalPair(payload));

      if (handover !== undefined && !handover.decoded) expect(handover.cause).toBe('round-trip-failed');
    }));
  }, TIMEOUT);
});

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeSetupBody, encodeSetupBody, type Hex } from '../../src/index';
import { body, run, safeInt, TIMEOUT } from './arbitraries';
import { oracleBody } from './support';

describe('setup body codec', () => {
  it('encodes every valid body to the reference abi.encode and decodes back to it', () => {
    run(
      fc.property(body, (b) => {
        const encoded = encodeSetupBody(b);

        expect(encoded).toBe(oracleBody(b));
        expect(decodeSetupBody(encoded)).toEqual(b);
        expect(encodeSetupBody(decodeSetupBody(encoded))).toBe(encoded);
      }),
    );
  }, TIMEOUT);

  it('is deterministic', () => {
    run(
      fc.property(body, (b) => {
        expect(encodeSetupBody(b)).toBe(encodeSetupBody(structuredClone(b)));
      }),
    );
  }, TIMEOUT);

  it('refuses a wait or threshold outside its width', () => {
    run(
      fc.property(body, safeInt(2 ** 48, Number.MAX_SAFE_INTEGER), fc.integer({ min: 256, max: 2 ** 31 - 1 }), (b, wait, threshold) => {
        expect(() => encodeSetupBody({ ...b, wait })).toThrow(RangeError);
        expect(() => encodeSetupBody({ ...b, clauses: [...b.clauses, { threshold, credentials: [] }] })).toThrow(RangeError);
      }),
    );
  }, TIMEOUT);

  it('refuses a credential that is not exactly 32 bytes and odd-length body bytes', () => {
    run(
      fc.property(body, fc.integer({ min: 0, max: 64 }).filter((n) => n !== 32), (b, n) => {
        const bad = `0x${'ab'.repeat(n)}` as Hex;

        expect(() => encodeSetupBody({ ...b, clauses: [{ threshold: 1, credentials: [bad] }] })).toThrow(TypeError);
        expect(() => decodeSetupBody(`${encodeSetupBody(b)}0` as Hex)).toThrow(TypeError);
      }),
    );
  }, TIMEOUT);
});

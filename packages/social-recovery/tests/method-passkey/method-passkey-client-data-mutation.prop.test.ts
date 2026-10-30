import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import {
  authenticatorData,
  base64url,
  bytesOf,
  configOfKey,
  ctxFor,
  FLAG_UP,
  FLAG_UV,
  hexOf,
  keyOfScalar,
  signAssertion,
  type AssertionParts,
} from './fixtures';
import { CHAIN_CLIENT_DATA_PREFIX, chainAcceptsClientData } from './chain-model';
import { digestArb, handProof, parameters, PROPERTY_TIMEOUT, yieldToWorker } from './property';

const method = passkeyMethod();
const rpId = 'wallet.example';
const key = keyOfScalar(0x5eed_c0ffeen);
const config = configOfKey(key, rpId);

/** One assertion over exactly this client data text, signed once. */
const partsOver = (text: string): AssertionParts => {
  const authData = authenticatorData(rpId, FLAG_UP | FLAG_UV, 1);

  return { authenticatorData: authData, clientDataJSON: text, signature: signAssertion(key, authData, text) };
};

const INTERESTING = [' ', '\n', '\t', '"', '\\', '=', '+', '/', '-', '_', '{', '}', ',', ':', 'T', 'A', 'a', '0', '\uFEFF', 'é'];

const mutation = fc.record({
  op: fc.constantFrom('insert', 'delete', 'replace'),
  at: fc.nat(),
  char: fc.constantFrom(...INTERESTING),
});

/** The text with one character inserted, deleted or replaced at `at` (mod its length). */
const mutate = (text: string, change: { op: string; at: number; char: string }): string => {
  const at = change.at % (text.length + 1);

  if (change.op === 'insert') return `${text.slice(0, at)}${change.char}${text.slice(at)}`;

  const index = Math.min(at, text.length - 1);

  return change.op === 'delete'
    ? `${text.slice(0, index)}${text.slice(index + 1)}`
    : `${text.slice(0, index)}${change.char}${text.slice(index + 1)}`;
};

describe('method-passkey properties: client data the chain refuses', () => {
  it(
    'never wider than the chain: a one-character change to a valid document is satisfied only where the chain accepts it',
    async () => {
      await fc.assert(
        fc.asyncProperty(digestArb, mutation, async (digest, change) => {
          await yieldToWorker();

          const ctx = ctxFor(config, { digest: hexOf(digest) });
          const valid = `${CHAIN_CLIENT_DATA_PREFIX}${base64url(digest)}","origin":"https://wallet.example","crossOrigin":false}`;
          const text = mutate(valid, change);

          // Only a text the chain refuses can break the property, so only those pay for a signature check.
          if (!chainAcceptsClientData(text, bytesOf(ctx.digest))) {
            expect(await method.verify(ctx, handProof(partsOver(text)))).toBe('rejected');
          }
        }),
        parameters,
      );
    },
    PROPERTY_TIMEOUT,
  );
});

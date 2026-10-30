import { createPublicKey, verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { passkeyMethod } from '../../src';
import type { Hex } from '../../src/interfaces';
import { readVector } from '../kat/read-vector';
import { chainAcceptsClientData } from './chain-model';
import { base64url, bytesOf, CONFIG_FILE, type ConfigVectorFile, ctxFor, derOf, hexOf, PROOF_FILE, type ProofVectorFile, sha256, word } from './fixtures';

const PIN_ROWS = ['missing-challenge-closing-quote', 'invalid-signature'] as const;

const method = passkeyMethod();
const copied = (readVector(PROOF_FILE) as unknown as ProofVectorFile).vectors;
const pinned = { vectors: copied.filter((row) => (PIN_ROWS as readonly unknown[]).includes(row['id'])) };
const configRow = (readVector(CONFIG_FILE) as unknown as ConfigVectorFile).vectors[0];
const config = (configRow?.expected.encoded ?? '0x') as Hex;

const signatureHolds = (row: ProofVectorFile['vectors'][number]): boolean =>
  nodeVerify(
    'sha256',
    new Uint8Array([...bytesOf(row.input.authenticatorData), ...sha256(row.input.clientDataJSON)]),
    {
      key: createPublicKey({
        key: { kty: 'EC', crv: 'P-256', x: base64url(word(BigInt(configRow?.input.x ?? '0'))), y: base64url(word(BigInt(configRow?.input.y ?? '0'))) },
        format: 'jwk',
      }),
      dsaEncoding: 'der',
    },
    derOf(BigInt(row.input.r), BigInt(row.input.s)),
  );

/** The copied row with this id; throws where the copy lacks it, so no assertion passes vacuously. */
const rowNamed = (name: string): ProofVectorFile['vectors'][number] => {
  const row = pinned.vectors.find((candidate) => candidate['id'] === name);

  if (row === undefined) throw new Error(`no copied row ${name}`);

  return row;
};

describe('the two proof rows the contracts pin added to the copied vector', () => {
  it('the copy holds both rows', () => {
    expect(pinned.vectors.map((row) => row['id'])).toEqual([...PIN_ROWS]);
  });

  for (const row of pinned.vectors) {
    const fields = {
      authenticatorData: row.input.authenticatorData.toLowerCase(),
      clientDataJSON: row.input.clientDataJSON,
      r: BigInt(row.input.r),
      s: BigInt(row.input.s),
    };

    it(`${row['id']}: encodeProof and decodeProof reproduce the pinned bytes`, () => {
      expect(method.codec.encodeProof(fields)).toBe(row.expected.encoded.toLowerCase());
      expect(method.codec.decodeProof(row.expected.encoded)).toEqual(fields);
    });

    it(`${row['id']}: the signed hash is sha256(authenticatorData || sha256(clientDataJSON))`, () => {
      const message = new Uint8Array([...bytesOf(row.input.authenticatorData), ...sha256(row.input.clientDataJSON)]);

      expect(hexOf(sha256(message))).toBe(row.expected.signedHash.toLowerCase());
    });

    it(`${row['id']}: verify answers rejected under the config row, as the chain does`, async () => {
      expect(row.expected.verification).toBe(false);
      expect(await method.verify(ctxFor(config, { digest: row.input.digest }), row.expected.encoded)).toBe('rejected');
    });
  }

  it('missing-challenge-closing-quote: the signature holds, so the refusal is the opening\'s alone', () => {
    const row = rowNamed('missing-challenge-closing-quote');

    expect(signatureHolds(row)).toBe(true);
    expect(chainAcceptsClientData(row.input.clientDataJSON, bytesOf(row.input.digest))).toBe(false);
  });

  it('invalid-signature: the opening is the chain\'s, so the refusal is the signature\'s alone', () => {
    const row = rowNamed('invalid-signature');

    expect(signatureHolds(row)).toBe(false);
    expect(chainAcceptsClientData(row.input.clientDataJSON, bytesOf(row.input.digest))).toBe(true);
  });
});

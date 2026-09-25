import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { Hex } from '../../src/interfaces';
import { readVector } from '../kat/read-vector';
import { asHex, encodeConfig, encodeProof, makeCtx, member, outerInputs, stackDouble, word } from './fixtures';

const IDENT = 0x7bn;

const CONFIG = encodeConfig(word(IDENT), word(1), 'recover.example', 'mast-social-recovery', 86400n);

const proofWith = (publicInputs: readonly string[]): Hex => encodeProof(word(0x63), '0x123456', publicInputs.map(asHex), '0x1234');

const cases: readonly (readonly [string, Hex, Hex, 'rejected' | 'not-judged'])[] = [
  ['a well-formed proof for the config\'s identifier, non-salted', CONFIG, proofWith(outerInputs(IDENT)), 'not-judged'],
  ['a proof whose scoped nullifier is another identifier', CONFIG, proofWith(outerInputs(IDENT + 1n)), 'rejected'],
  ['a salted nullifier type (1)', CONFIG, proofWith(outerInputs(IDENT, 1n)), 'rejected'],
  ['a dev-mode mock nullifier type (2)', CONFIG, proofWith(outerInputs(IDENT, 2n)), 'rejected'],
  ['a dev-mode mock nullifier type (3)', CONFIG, proofWith(outerInputs(IDENT, 3n)), 'rejected'],
  ['no public inputs', CONFIG, proofWith([]), 'rejected'],
  ['two public inputs', CONFIG, proofWith([word(0), word(IDENT)]), 'rejected'],
  ['proof bytes with a trailing byte', CONFIG, `${proofWith(outerInputs(IDENT))}00`, 'rejected'],
  ['proof bytes one byte short', CONFIG, proofWith(outerInputs(IDENT)).slice(0, -2) as Hex, 'rejected'],
  ['empty proof bytes', CONFIG, '0x', 'rejected'],
  ['proof bytes that are the config layout', CONFIG, CONFIG, 'rejected'],
  ['a config that is the bare identifier word, not the layout', word(IDENT), proofWith(outerInputs(IDENT)), 'rejected'],
  ['a config with a trailing byte', `${CONFIG}00`, proofWith(outerInputs(IDENT)), 'rejected'],
];

describe('verify answers from local facts alone and never asks the stack', () => {
  it.each(cases)('%s → %s', async (_why, config, proof, verdict) => {
    const double = stackDouble();

    await expect(zkPassportMethod(double.stack).verify(makeCtx(config), proof)).resolves.toBe(verdict);
    expect(double.calls).toEqual([]);
  });

  it('never answers satisfied, even for a proof that passes every local check', async () => {
    const verdicts = await Promise.all(cases.map(([, config, proof]) => zkPassportMethod(stackDouble().stack).verify(makeCtx(config), proof)));

    expect(verdicts).not.toContain('satisfied');
  });

  it('answers without a stack that would throw on any use', async () => {
    const double = stackDouble({ constructThrows: true, verifierThrows: true });
    const method = zkPassportMethod(double.stack);

    await expect(method.verify(makeCtx(CONFIG), proofWith(outerInputs(IDENT)))).resolves.toBe('not-judged');
    await expect(method.verify(makeCtx(CONFIG), '0x')).resolves.toBe('rejected');
    expect(double.calls).toEqual([]);
  });

  it('the default factory (no double) verifies without loading the stack', async () => {
    await expect(zkPassportMethod().verify(makeCtx(CONFIG), proofWith(outerInputs(IDENT)))).resolves.toBe('not-judged');
  });
});

const configFile = readVector('method-zkpassport-config.json');
const proofFile = readVector('method-zkpassport-proof.json');

describe('verify over the blessed rows', () => {
  it('the config row and the proof row agree on the identifier, so the answer is not judged (synthetic proof, no live verifier)', async () => {
    const double = stackDouble();
    const config = asHex(member(configFile.vectors[0], 'expected', 'encoded'));
    const proof = asHex(member(proofFile.vectors[0], 'expected', 'encoded'));
    const digest = asHex(member(proofFile.vectors[0], 'input', 'digest'));

    await expect(zkPassportMethod(double.stack).verify(makeCtx(config, digest), proof)).resolves.toBe('not-judged');
    expect(double.calls).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import type { ProofWords, Signals } from './fixtures';
import { configBytes, ctxFor, nine, proofBytes, proofRow, signalsFor, stackDouble } from './fixtures';

const DIGEST: Hex = `0x${'ab'.repeat(32)}`;
const NULLIFIER = 1234n;
const SEED = 42n;
const CTX = ctxFor(configBytes(NULLIFIER, SEED), DIGEST);

const proofWith = (overrides: Partial<Signals> = {}): Hex => {
  const words: ProofWords = {
    a: [1n, 2n],
    b: [
      [4n, 3n],
      [6n, 5n],
    ],
    c: [7n, 8n],
    inputs: nine(signalsFor(NULLIFIER, SEED, DIGEST, overrides)),
  };

  return proofBytes(words);
};

describe('bindings refused without any stack call', () => {
  it.each([
    ['nullifier', { nullifier: NULLIFIER + 1n }],
    ['nullifier seed', { nullifierSeed: SEED + 1n }],
    ['signal hash', { signalHash: 0n }],
    ['nullifier and seed swapped', { nullifier: SEED, nullifierSeed: NULLIFIER }],
  ])('a %s mismatch is rejected', async (_label, overrides) => {
    const double = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(CTX, proofWith(overrides))).toBe('rejected');
    expect(double.total()).toBe(0);
  });

  it('a proof for another digest is rejected', async () => {
    const double = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(ctxFor(configBytes(NULLIFIER, SEED), `0x${'cd'.repeat(32)}`), proofWith())).toBe('rejected');
    expect(double.total()).toBe(0);
  });

  it.each([
    ['empty bytes', '0x'],
    ['543 bytes', proofWith().slice(0, -2)],
    ['a tenth input', `${proofWith()}${'00'.repeat(32)}`],
  ])('undecodable proof bytes (%s) are rejected, never thrown', async (_label, bytes) => {
    const double = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(CTX, bytes as Hex)).toBe('rejected');
    expect(double.total()).toBe(0);
  });
});

describe('a consistent proof', () => {
  it('with no stack is not-judged', async () => {
    expect(await anonAadhaarMethod().verify(CTX, proofWith())).toBe('not-judged');
  });

  it('with a stack that throws on the issuer key is not-judged', async () => {
    const double = stackDouble({ verify: 'throw' });

    expect(await anonAadhaarMethod({ stack: double.stack }).verify(CTX, proofWith())).toBe('not-judged');
    expect(double.verifyCalls).toHaveLength(1);
  });

  it('with a stack answering false is rejected, true is satisfied, and no prover runs', async () => {
    const no = stackDouble({ verify: false });
    const yes = stackDouble({ verify: true });

    expect(await anonAadhaarMethod({ stack: no.stack }).verify(CTX, proofWith())).toBe('rejected');
    expect(await anonAadhaarMethod({ stack: yes.stack }).verify(CTX, proofWith())).toBe('satisfied');
    expect([...no.order, ...yes.order]).toEqual(['verify', 'verify']);
  });

  it('hands the stack the nine signals by name and pi_b back in snarkjs order', async () => {
    const double = stackDouble({ verify: true });

    await anonAadhaarMethod({ stack: double.stack }).verify(CTX, proofWith());

    const proof = double.verifyCalls[0]?.proof;

    expect(proof?.nullifier).toBe(NULLIFIER.toString());
    expect(proof?.nullifierSeed).toBe(SEED.toString());
    expect(proof?.pubkeyHash).toBe('99');
    expect(proof?.timestamp).toBe('1700000000');
    expect(proof?.signalHash).toBe(signalsFor(NULLIFIER, SEED, DIGEST).signalHash.toString());
    expect(proof?.groth16Proof.pi_a.slice(0, 2)).toEqual(['1', '2']);
    expect(proof?.groth16Proof.pi_b.slice(0, 2)).toEqual([
      ['3', '4'],
      ['5', '6'],
    ]);
    expect(proof?.groth16Proof.pi_c.slice(0, 2)).toEqual(['7', '8']);
  });
});

describe('the blessed proof row', () => {
  it('binds under its own config and digest: not-judged with no stack, rejected under another seed', async () => {
    const bound = ctxFor(configBytes(22n, 77n), proofRow.input.digest);

    expect(await anonAadhaarMethod().verify(bound, proofRow.expected.encoded)).toBe('not-judged');
    expect(await anonAadhaarMethod().verify(ctxFor(configBytes(22n, 78n), proofRow.input.digest), proofRow.expected.encoded)).toBe('rejected');
  });
});

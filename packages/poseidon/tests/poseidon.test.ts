import { describe, expect, it } from 'vitest';
import { poseidonT3 } from '../src/index.ts';

// circomlibjs poseidon([1, 2])
const EXPECTED_1_2 = 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189an;

describe('poseidonT3', () => {
  it('hashes [1, 2] to the reference value', () => {
    expect(poseidonT3(1n, 2n)).toBe(EXPECTED_1_2);
  });
});

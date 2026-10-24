import { describe, expect, it, vi } from 'vitest';
import { createSnarkjsProver, type ProverArtifacts } from '../../src';

describe('createSnarkjsProver', () => {
  it('tries the download again after one fails, instead of remembering the failure', async () => {
    const artifacts = vi.fn(async (): Promise<ProverArtifacts> => { throw new Error('connection reset'); });
    const prover = createSnarkjsProver({ artifacts });

    await expect(prover.prove({})).rejects.toThrow('connection reset');
    await expect(prover.prove({})).rejects.toThrow('connection reset');
    expect(artifacts).toHaveBeenCalledTimes(2);
  });

  it('proves one at a time', async () => {
    let running = 0;
    let most = 0;
    const artifacts = vi.fn(async (): Promise<ProverArtifacts> => {
      running++;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
      throw new Error('stop before snarkjs');
    });
    const prover = createSnarkjsProver({ artifacts });

    await Promise.allSettled([prover.prove({}), prover.prove({}), prover.prove({})]);
    expect(most).toBe(1);
  });
});

import type { Network } from '@kohaku-eth/plugins';
import { describe, expect, it, vi } from 'vitest';
import vk from '../fixtures/transact_vk.json';
import { loadArtifacts, TacitArtifacts, type VerifyingKey } from '../../src';
import { vkHash } from '../../src/prover/artifacts';

const key = vk as unknown as VerifyingKey;

describe('vkHash', () => {
  it('matches the ceremony\'s pin for its verification key', () => {
    expect(vkHash(key)).toBe(TacitArtifacts.vk.hash);
  });

  it('changes with any limb of the key', () => {
    const IC = key.IC.map((point) => [...point]);

    IC[3]![0] = (BigInt(IC[3]![0]!) + 1n).toString();
    expect(vkHash({ ...key, IC })).not.toBe(TacitArtifacts.vk.hash);
  });

  it('refuses a key for another curve or circuit', () => {
    expect(() => vkHash({ ...key, curve: 'bls12381' })).toThrow(/verification key/);
    expect(() => vkHash({ ...key, nPublic: 12 })).toThrow(/verification key/);
  });
});

describe('loadArtifacts', () => {
  it('refuses files that do not match their pins, naming each source it tried', async () => {
    const fetch = vi.fn(async () => new Response('not the proving key'));
    const error = await loadArtifacts({ fetch } as unknown as Network).catch((e) => e);

    expect(error.message).toMatch(/could not load/);
    expect(error.message).toMatch(/does not match the pin/);
    expect(error.message).toContain('tacit.finance');
    expect(error.message).toContain('ipfs.io');
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('reports a source that fails and goes on to the next', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes('tacit.finance')) throw new Error('connection refused');

      return new Response('', { status: 503 });
    });
    const error = await loadArtifacts({ fetch } as unknown as Network).catch((e) => e);

    expect(error.message).toContain('connection refused');
    expect(error.message).toContain('HTTP 503');
  });

  it('accepts the verification key alone when it is the pinned one', async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) => (String(url).includes('vk') ? Response.json(vk) : new Response('x')));
    const error = await loadArtifacts({ fetch } as unknown as Network).catch((e) => e);

    // The wasm and zkey are wrong, so the load fails, but not on the key.
    expect(error.message).toMatch(/witness program|proving key/);
    expect(error.message).not.toMatch(/verification key:/);
  });
});

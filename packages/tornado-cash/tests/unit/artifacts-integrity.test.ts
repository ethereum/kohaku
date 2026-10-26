import { describe, expect, it, vi } from 'vitest';
import {
  assertTornadoArtifacts,
  TornadoArtifactsIntegrityError,
} from '../../src/utils/artifacts-integrity';
import { loadCircuitFiles } from '../../src/utils/circuit-loader';
import { makeLazyProverFactory } from '../../src/utils/prover-factory';

// A legacy circom circuit whose only template runs its payload when the witness
// generator compiles it.
const injectedCircuit = JSON.stringify({
  templates: { Withdraw: 'function(ctx) { globalThis.__tornadoPwned = true; }' },
  functions: {},
  components: [{ name: 'main', params: {}, template: 'Withdraw', inputSignals: 0 }],
  signals: [{ names: ['one'], triggerComponents: [] }],
  signalName2Idx: { one: 0 },
});

describe('tornado artifacts integrity', () => {
  it('rejects a circuit that is not the pinned one', () => {
    expect(() => assertTornadoArtifacts({
      circuitText: injectedCircuit,
      provingKey: new ArrayBuffer(8),
    })).toThrow(TornadoArtifactsIntegrityError);
  });

  it('refuses to build a prover from tampered artifacts, whatever the loader', async () => {
    const loader = vi.fn().mockResolvedValue({ circuitText: injectedCircuit, provingKey: new ArrayBuffer(8) });
    const getProver = makeLazyProverFactory(loader);

    await expect(getProver()).rejects.toThrow(TornadoArtifactsIntegrityError);
    expect((globalThis as { __tornadoPwned?: boolean }).__tornadoPwned).toBeUndefined();

    // A failed check is not cached: the next call reloads and checks again.
    await expect(getProver()).rejects.toThrow(TornadoArtifactsIntegrityError);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('fails on an HTTP error instead of passing the error page on', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 }));

    vi.stubGlobal('fetch', fetchMock);

    try {
      await expect(loadCircuitFiles('https://example.test/c.json', 'https://example.test/pk.bin'))
        .rejects.toThrow('HTTP 404');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

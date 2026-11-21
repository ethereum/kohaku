import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  METHOD_AADHAAR_ARTIFACT_HASH_MESSAGE,
  METHOD_AADHAAR_BUCKET_CHUNKED,
  METHOD_AADHAAR_BUCKET_SERVER,
  METHOD_AADHAAR_STACK_DOWNLOAD_MESSAGE,
} from '../../src/constants/method-aadhaar-bucket';
import type { Hex } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { pinnedArtifacts } from '../../src/method-aadhaar/artifacts';
import { AadhaarStackUnavailable, coreStack } from '../../src/method-aadhaar/stack';
import { REPO_ROOT } from '../helpers/source';
import { CERTIFICATE, clockForFile, configBytes, ctxFor, FRESH_NOW, isFailure, nine, pcdOf, proofBytes, QR_DATA, signalsFor, SYNTHETIC_UPSTREAM } from './fixtures';
import { newPagePerTest } from './new-page';
import { SERVED_VKEY, SERVED_WASM, servedInit } from './served-bucket';

const core = vi.hoisted(() => ({
  init: vi.fn((): Promise<void> => Promise.resolve()),
  generateArgs: vi.fn((): Promise<unknown> => Promise.resolve({})),
  prove: vi.fn<(args: unknown, onProgress?: (state: string) => void) => Promise<unknown>>(() => Promise.resolve({})),
  verify: vi.fn<(pcd: unknown, testMode?: boolean) => Promise<boolean>>(() => Promise.resolve(true)),
}));

vi.mock('@anon-aadhaar/core', () => ({
  ...core,
  ArtifactsOrigin: { server: 0, local: 1, chunked: 2 },
  productionPublicKeyHash: '18063425702624337643644061197836918910810808173893535653269228433734128853484',
  testPublicKeyHash: '15134874015316324267425466444584014077184337590635665158241104437045239495873',
}));

/** The pinned hashes replaced by the served bytes' own, so a stack over the bucket loads against the stubbed fetch. */
vi.mock('../../src/constants/method-aadhaar-bucket', async (importOriginal) => {
  const { withServedHashes } = await import('./served-bucket');

  return withServedHashes(await importOriginal<typeof import('../../src/constants/method-aadhaar-bucket')>());
});

/** The proof vector's digest. */
const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const ctx = ctxFor(configBytes(22n, 77n), DIGEST);
const boundPcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST));
const PRODUCTION_KEY = 18063425702624337643644061197836918910810808173893535653269228433734128853484n;
const production = proofBytes({
  a: [1n, 2n],
  b: [
    [4n, 3n],
    [6n, 5n],
  ],
  c: [7n, 8n],
  inputs: nine(signalsFor(22n, 77n, DIGEST, { pubkeyHash: PRODUCTION_KEY })),
});
const ARTIFACTS = {
  wasmURL: 'https://unreachable.invalid/circuit.wasm',
  zkeyURL: 'https://unreachable.invalid/circuit.zkey',
  vkeyURL: 'https://unreachable.invalid/vkey.json',
  artifactsOrigin: 'server',
} as const;
const EXPECTED = { wasm: sha256(SERVED_WASM), vkey: sha256(SERVED_VKEY) } as const;

clockForFile(FRESH_NOW);

newPagePerTest();

/** One byte flipped, so the hash no longer matches. */
const tampered = (bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => bytes.map((byte, index) => (index === 0 ? byte ^ 1 : byte));

type Answer = Uint8Array<ArrayBuffer> | 'reject' | number;

/** What the stubbed fetch answers per URL, and every URL it was asked for. */
const served: { wasm: Answer; vkey: Answer; fetched: string[] } = { wasm: SERVED_WASM, vkey: SERVED_VKEY, fetched: [] };
const realFetch = globalThis.fetch;

const respond = (answer: Answer, url: string): Promise<Response> => {
  if (answer === 'reject') return Promise.reject(new TypeError(`fetch failed: ${url}`));

  if (typeof answer === 'number') return Promise.resolve(new Response('not found', { status: answer }));

  return Promise.resolve(new Response(answer));
};

beforeEach(() => {
  vi.clearAllMocks();
  served.wasm = SERVED_WASM;
  served.vkey = SERVED_VKEY;
  served.fetched = [];
  vi.stubGlobal('fetch', (input: string | URL | Request): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);

    if (url.startsWith('blob:')) return realFetch(input);

    served.fetched.push(url);

    if (url === METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL) return respond(served.wasm, url);

    if (url === METHOD_AADHAAR_BUCKET_CHUNKED.vkeyURL) return respond(served.vkey, url);

    return Promise.reject(new TypeError(`fetch failed: ${url} is not served in tests`));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the bucket check over synthetic bytes, the expected hashes passed in', () => {
  it('matching bytes give object URLs for the wasm and vkey, the zkey URL and origin unchanged, each file fetched once', async () => {
    const checked = await pinnedArtifacts(METHOD_AADHAAR_BUCKET_CHUNKED, EXPECTED);

    expect(checked).toEqual({
      wasmURL: expect.stringMatching(/^blob:/),
      zkeyURL: METHOD_AADHAAR_BUCKET_CHUNKED.zkeyURL,
      vkeyURL: expect.stringMatching(/^blob:/),
      artifactsOrigin: 'chunked',
    });
    expect([...served.fetched].sort()).toEqual([METHOD_AADHAAR_BUCKET_CHUNKED.vkeyURL, METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL].sort());
  });

  it('fetching each object URL returns exactly the verified bytes', async () => {
    const checked = await pinnedArtifacts(METHOD_AADHAAR_BUCKET_CHUNKED, EXPECTED);

    expect(checked).toBeDefined();

    const wasm = new Uint8Array(await (await fetch(checked?.wasmURL ?? '')).arrayBuffer());
    const vkey = new Uint8Array(await (await fetch(checked?.vkeyURL ?? '')).arrayBuffer());

    expect(wasm).toEqual(SERVED_WASM);
    expect(vkey).toEqual(SERVED_VKEY);
  });

  it('the server bucket names the same wasm and vkey, so it is checked too, its whole-zkey URL kept', async () => {
    expect(await pinnedArtifacts(METHOD_AADHAAR_BUCKET_SERVER, EXPECTED)).toEqual({
      wasmURL: expect.stringMatching(/^blob:/),
      zkeyURL: METHOD_AADHAAR_BUCKET_SERVER.zkeyURL,
      vkeyURL: expect.stringMatching(/^blob:/),
      artifactsOrigin: 'server',
    });
  });

  it.each([
    ['a wasm one byte off', (): void => {
      served.wasm = tampered(SERVED_WASM);
    }],
    ['a vkey one byte off', (): void => {
      served.vkey = tampered(SERVED_VKEY);
    }],
    ['the wasm and the vkey swapped', (): void => {
      served.wasm = SERVED_VKEY;
      served.vkey = SERVED_WASM;
    }],
    ['a wasm fetch that rejects', (): void => {
      served.wasm = 'reject';
    }],
    ['a vkey answered 404', (): void => {
      served.vkey = 404;
    }],
    ['a wasm answered 500', (): void => {
      served.wasm = 500;
    }],
  ] as const)('%s fails the check', async (_why, arrange) => {
    arrange();

    expect(await pinnedArtifacts(METHOD_AADHAAR_BUCKET_CHUNKED, EXPECTED)).toBeUndefined();
  });

  it('the pinned record of another build fails bytes that match this one', async () => {
    expect(await pinnedArtifacts(METHOD_AADHAAR_BUCKET_CHUNKED, { wasm: EXPECTED.vkey, vkey: EXPECTED.wasm })).toBeUndefined();
  });

  it.each([
    ['the integrator\'s own URLs', ARTIFACTS],
    ['local paths', { wasmURL: '/srv/aadhaar/circuit.wasm', zkeyURL: '/srv/aadhaar/circuit_final.zkey', vkeyURL: '/srv/aadhaar/vkey.json', artifactsOrigin: 'local' }],
    ['the bucket wasm beside the integrator\'s vkey', { ...METHOD_AADHAAR_BUCKET_CHUNKED, vkeyURL: ARTIFACTS.vkeyURL }],
  ] as const)('%s are returned as given and nothing is fetched', async (_why, artifacts) => {
    expect(await pinnedArtifacts(artifacts, EXPECTED)).toStrictEqual(artifacts);
    expect(served.fetched).toEqual([]);
  });
});

describe('the default stack over the bucket, the pinned hashes those of the served bytes', () => {
  it('matching files: init receives object URLs for the wasm and vkey and the chunked zkey URL', async () => {
    expect(await anonAadhaarMethod().verify(ctx, production)).toBe('satisfied');
    expect(core.init.mock.calls).toEqual([[servedInit(METHOD_AADHAAR_BUCKET_CHUNKED, 2)]]);
  });

  it('the server bucket: object URLs for the wasm and vkey and the whole-zkey URL', async () => {
    expect(await anonAadhaarMethod({ artifacts: METHOD_AADHAAR_BUCKET_SERVER }).verify(ctx, production)).toBe('satisfied');
    expect(core.init.mock.calls).toEqual([[servedInit(METHOD_AADHAAR_BUCKET_SERVER, 0)]]);
  });

  it('the files are fetched once per stack load, not once per call', async () => {
    const method = anonAadhaarMethod();

    await method.verify(ctx, production);
    await method.verify(ctx, production);

    expect(served.fetched).toHaveLength(2);
    expect(core.init).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a wasm one byte off', (): void => {
      served.wasm = tampered(SERVED_WASM);
    }],
    ['a vkey one byte off', (): void => {
      served.vkey = tampered(SERVED_VKEY);
    }],
    ['a wasm fetch that rejects', (): void => {
      served.wasm = 'reject';
    }],
    ['a vkey answered 404', (): void => {
      served.vkey = 404;
    }],
  ] as const)('%s: configFrom and replyFrom are device-unavailable, init and the prover never called', async (_why, arrange) => {
    arrange();

    const method = anonAadhaarMethod();
    const config = await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA });
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA });

    expect(isFailure(config, 'device-unavailable')).toBe(true);
    expect(isFailure(reply, 'device-unavailable')).toBe(true);
    expect(core.init).not.toHaveBeenCalled();
    expect(core.generateArgs).not.toHaveBeenCalled();
    expect(core.prove).not.toHaveBeenCalled();
  });

  it('a failed check rejects the stack call with the hash message, and verify reads it as not-judged', async () => {
    served.wasm = tampered(SERVED_WASM);

    const rejected = await coreStack(METHOD_AADHAAR_BUCKET_CHUNKED).generateArgs({ qrData: QR_DATA, certificateFile: CERTIFICATE, nullifierSeed: 77n, fieldsToRevealArray: [] }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejected).toBeInstanceOf(AadhaarStackUnavailable);
    expect((rejected as Error).message).toBe(METHOD_AADHAAR_ARTIFACT_HASH_MESSAGE);
    expect(await anonAadhaarMethod().verify(ctx, production)).toBe('not-judged');
    expect(core.init).not.toHaveBeenCalled();
  });

  it('a failed check is retried on the next call, which loads once the files match', async () => {
    served.wasm = 'reject';

    const method = anonAadhaarMethod();

    expect(await method.verify(ctx, production)).toBe('not-judged');

    served.wasm = SERVED_WASM;

    expect(await method.verify(ctx, production)).toBe('satisfied');
    expect(served.fetched.filter((url) => url === METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL)).toHaveLength(2);
    expect(core.init.mock.calls).toEqual([[servedInit(METHOD_AADHAAR_BUCKET_CHUNKED, 2)]]);
  });

  it('the integrator\'s own URLs: no fetch by the SDK, init with them unchanged', async () => {
    expect(await anonAadhaarMethod({ artifacts: ARTIFACTS }).verify(ctx, production)).toBe('satisfied');
    expect(served.fetched).toEqual([]);
    expect(core.init.mock.calls).toEqual([[{ ...ARTIFACTS, artifactsOrigin: 0 }]]);
  });
});

/** The method folder and the bucket check loaded afresh, so no pair an earlier test checked is in memory. */
async function freshModules() {
  vi.resetModules();

  const { anonAadhaarMethod: method } = await import('../../src/method-aadhaar');
  const { pinnedArtifacts: pinned } = await import('../../src/method-aadhaar/artifacts');

  return { anonAadhaarMethod: method, pinnedArtifacts: pinned };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const realCreate = URL.createObjectURL.bind(URL);
const realRevoke = URL.revokeObjectURL.bind(URL);

/** Spies on the object URL calls, the real ones still answering, with every URL created and every URL revoked. */
function watchObjectUrls() {
  const create = vi.spyOn(URL, 'createObjectURL');
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const created = (): string[] => create.mock.results.flatMap((result) => (result.type === 'return' ? [result.value] : []));
  const revoked = (): string[] => revoke.mock.calls.map(([url]) => url);

  return { create, revoke, created, revoked, live: (): string[] => created().filter((url) => !revoked().includes(url)).sort() };
}

/** The wasm and vkey URLs of one `init` argument, sorted. */
const pairOf = (args: unknown): string[] => {
  const { wasmURL, vkeyURL } = args as { wasmURL: string; vkeyURL: string };

  return [wasmURL, vkeyURL].sort();
};

const initArgs = (): unknown[] => core.init.mock.calls.map((call) => (call as unknown[])[0]);
const wasmFetches = (): number => served.fetched.filter((url) => url === METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL).length;

describe('one checked pair per page, whatever number of default stacks', () => {
  let urls: ReturnType<typeof watchObjectUrls>;

  beforeEach(() => {
    urls = watchObjectUrls();
  });

  afterEach(() => {
    const made = urls.created();

    urls.create.mockRestore();
    urls.revoke.mockRestore();

    for (const url of made) realRevoke(url);
  });

  it('three default stacks in turn: each bucket file fetched once, two object URLs in all, every init on that pair, none revoked', async () => {
    const fresh = await freshModules();

    for (let stack = 0; stack < 3; stack += 1) expect(await fresh.anonAadhaarMethod().verify(ctx, production)).toBe('satisfied');

    const [first] = initArgs();

    expect([...served.fetched].sort()).toEqual([METHOD_AADHAAR_BUCKET_CHUNKED.vkeyURL, METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL].sort());
    expect(urls.create).toHaveBeenCalledTimes(2);
    expect(first).toStrictEqual(servedInit(METHOD_AADHAAR_BUCKET_CHUNKED, 2));

    for (const args of initArgs()) expect(args).toStrictEqual(first);

    expect(urls.live()).toEqual(pairOf(first));
  });

  it('three default stacks whose loads overlap while the first fetch is pending share that fetch of each file and one pair', async () => {
    const fresh = await freshModules();
    const serving = globalThis.fetch;
    let opened: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      opened = resolve;
    });
    let asked = 0;

    vi.stubGlobal('fetch', (input: string | URL | Request): Promise<Response> => {
      asked += 1;

      return gate.then(() => serving(input));
    });

    const loads = [fresh.anonAadhaarMethod().verify(ctx, production)];

    await vi.waitFor(() => expect(asked).toBeGreaterThan(0));

    for (let later = 0; later < 2; later += 1) {
      loads.push(fresh.anonAadhaarMethod().verify(ctx, production));
      // spaced so no two loads import the mocked peer at once, which a vitest factory mock does not support
      await sleep(20);
    }

    opened();

    const verdicts = await Promise.all(loads);

    expect(verdicts).toEqual(['satisfied', 'satisfied', 'satisfied']);
    expect([...served.fetched].sort()).toEqual([METHOD_AADHAAR_BUCKET_CHUNKED.vkeyURL, METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL].sort());
    expect(urls.create).toHaveBeenCalledTimes(2);
    expect(new Set(initArgs().map((args) => pairOf(args).join(' '))).size).toBe(1);
  });

  it.each([
    ['a wasm one byte off', (): void => {
      served.wasm = tampered(SERVED_WASM);
    }],
    ['a vkey fetch that rejects', (): void => {
      served.vkey = 'reject';
    }],
    ['a wasm answered 500', (): void => {
      served.wasm = 500;
    }],
  ] as const)('%s, then a new stack that loads, then two more: the failure is retried once, one pair is created and stays live', async (_why, arrange) => {
    const fresh = await freshModules();
    const failed = fresh.anonAadhaarMethod();

    arrange();

    expect(await failed.verify(ctx, production)).toBe('not-judged');

    served.wasm = SERVED_WASM;
    served.vkey = SERVED_VKEY;

    expect(await fresh.anonAadhaarMethod().verify(ctx, production)).toBe('satisfied');
    expect(await failed.verify(ctx, production)).toBe('satisfied');
    expect(await fresh.anonAadhaarMethod().verify(ctx, production)).toBe('satisfied');
    expect(wasmFetches()).toBe(2);
    expect(urls.created()).toHaveLength(2);
    expect(urls.live()).toEqual(pairOf(initArgs()[0]));
  });

  it('a throw creating the second object URL revokes the first, reads device-unavailable, and the next load fetches again', async () => {
    const fresh = await freshModules();
    const method = fresh.anonAadhaarMethod();

    urls.create.mockImplementationOnce(realCreate).mockImplementationOnce(() => {
      throw new RangeError('Array buffer allocation failed');
    });

    expect(isFailure(await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA }), 'device-unavailable')).toBe(true);
    expect(core.init).not.toHaveBeenCalled();

    const abandoned = urls.created();

    expect(abandoned).toHaveLength(1);
    expect(urls.revoked()).toEqual(abandoned);

    expect(await fresh.anonAadhaarMethod().verify(ctx, production)).toBe('satisfied');
    expect(wasmFetches()).toBe(2);
    expect(urls.live()).toEqual(pairOf(initArgs()[0]));
  });

  it('the server record reuses the pair the chunked record checked, with its own zkey URL and origin, and fetches nothing', async () => {
    const fresh = await freshModules();
    const chunked = await fresh.pinnedArtifacts(METHOD_AADHAAR_BUCKET_CHUNKED, EXPECTED);
    const fetched = served.fetched.length;

    expect(await fresh.pinnedArtifacts(METHOD_AADHAAR_BUCKET_SERVER, EXPECTED)).toStrictEqual({
      wasmURL: chunked?.wasmURL,
      zkeyURL: METHOD_AADHAAR_BUCKET_SERVER.zkeyURL,
      vkeyURL: chunked?.vkeyURL,
      artifactsOrigin: 'server',
    });
    expect(served.fetched).toHaveLength(fetched);
    expect(urls.create).toHaveBeenCalledTimes(2);
  });

  it('another expected record is another pair: its mismatch neither revokes nor replaces the checked one', async () => {
    const fresh = await freshModules();
    const checked = await fresh.pinnedArtifacts(METHOD_AADHAAR_BUCKET_CHUNKED, EXPECTED);

    expect(await fresh.pinnedArtifacts(METHOD_AADHAAR_BUCKET_CHUNKED, { wasm: EXPECTED.vkey, vkey: EXPECTED.wasm })).toBeUndefined();

    const fetched = served.fetched.length;

    expect(await fresh.pinnedArtifacts(METHOD_AADHAAR_BUCKET_CHUNKED, EXPECTED)).toStrictEqual(checked);
    expect(served.fetched).toHaveLength(fetched);
    expect(urls.revoke).not.toHaveBeenCalled();
  });

  it('the integrator\'s own URLs create no object URL', async () => {
    const fresh = await freshModules();

    expect(await fresh.pinnedArtifacts(ARTIFACTS, EXPECTED)).toStrictEqual(ARTIFACTS);
    expect(urls.create).not.toHaveBeenCalled();
  });
});

/** The peer's `prove` reporting `states` through its callback, then rejecting as the peer does. */
const provingThrough = (states: readonly string[]) => (_args: unknown, onProgress?: (state: string) => void): Promise<unknown> => {
  for (const state of states) onProgress?.(state);

  return Promise.reject(new Error('[AnonAAdhaarProver]: Error while generating the proof'));
};

describe('a proof the peer fails, classified by the last state it reported', () => {
  it.each([
    ['while fetching the wasm', 'device-unavailable', ['fetching-wasm']],
    ['while fetching the zkey', 'device-unavailable', ['fetching-wasm', 'fetching-zkey']],
    ['while proving', 'material-rejected', ['fetching-wasm', 'fetching-zkey', 'proving']],
    ['after proving, with its error state', 'material-rejected', ['fetching-wasm', 'fetching-zkey', 'proving', 'error']],
    ['before any state', 'material-rejected', []],
  ] as const)('%s: configFrom and replyFrom are %s, and the page sees every state', async (_why, cause, states) => {
    core.prove.mockImplementation(provingThrough(states));

    for (const artifacts of [ARTIFACTS, METHOD_AADHAAR_BUCKET_CHUNKED]) {
      const method = anonAadhaarMethod({ artifacts });
      const seen: string[] = [];
      const onProgress = (state: string): void => {
        seen.push(state);
      };
      const config = await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA, onProgress });

      expect(isFailure(config, cause)).toBe(true);
      expect(seen).toEqual(states);

      seen.length = 0;

      const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, onProgress });

      expect(isFailure(reply, cause)).toBe(true);
      expect(seen).toEqual(states);
    }
  });

  it('a download failure rejects the stack\'s prove with the download message and the peer\'s error as its cause', async () => {
    const peerError = new Error('fetch failed: circuit_final_3.gz');

    core.prove.mockImplementation((_args, onProgress) => {
      onProgress?.('fetching-wasm');
      onProgress?.('fetching-zkey');

      return Promise.reject(peerError);
    });

    const rejected = await coreStack(ARTIFACTS).prove({}, undefined).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejected).toBeInstanceOf(AadhaarStackUnavailable);
    expect((rejected as Error).message).toBe(METHOD_AADHAAR_STACK_DOWNLOAD_MESSAGE);
    expect((rejected as Error).cause).toBe(peerError);
  });

  it('a proof after every state reaches the page with each of them, unchanged', async () => {
    const states = ['fetching-wasm', 'fetching-zkey', 'proving', 'completed'];

    core.prove.mockImplementation((_args, onProgress) => {
      for (const state of states) onProgress?.(state);

      return Promise.resolve(boundPcd);
    });

    const method = anonAadhaarMethod({ artifacts: ARTIFACTS });
    const seen: string[] = [];
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), {
      qrData: QR_DATA,
      onProgress: (state: string): void => {
        seen.push(state);
      },
    });

    expect(typeof reply).toBe('string');
    expect(seen).toEqual(states);
  });
});

describe('the artifact checks\' changeset', () => {
  const text = readFileSync(join(REPO_ROOT, '.changeset', 'aadhaar-artifact-checks.md'), 'utf8');

  it('is a patch naming the pinned hashes and both messages, with a Compatibility line for the new device-unavailable', () => {
    expect(text).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);

    for (const name of ['METHOD_AADHAAR_BUCKET_SHA256', 'METHOD_AADHAAR_ARTIFACT_HASH_MESSAGE', 'METHOD_AADHAAR_STACK_DOWNLOAD_MESSAGE', 'device-unavailable']) {
      expect(text, name).toContain(name);
    }

    expect(text).toContain('Compatibility');
    expect(text).not.toMatch(/^\s*(\*\*)?breaking/im);
  });
});

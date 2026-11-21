import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_BUCKET_CHUNKED } from '../../src/constants/method-aadhaar-bucket';
import type { Hex, IRecoveryMethod, Material } from '../../src/interfaces';
import { jsDocOf, REPO_ROOT, SRC_ROOT } from '../helpers/source';
import { CERTIFICATE, clockForFile, configBytes, ctxFor, FRESH_NOW, isFailure, nine, pcdOf, proofBytes, QR_DATA, signalsFor, SYNTHETIC_UPSTREAM } from './fixtures';
import { serveBucket, servedInit } from './served-bucket';

const core = vi.hoisted(() => ({
  init: vi.fn<(args: unknown) => Promise<void>>(() => Promise.resolve()),
  generateArgs: vi.fn<(options: unknown) => Promise<unknown>>(() => Promise.resolve({})),
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
const INTEGRATOR = {
  wasmURL: 'https://unreachable.invalid/circuit.wasm',
  zkeyURL: 'https://unreachable.invalid/circuit.zkey',
  vkeyURL: 'https://unreachable.invalid/vkey.json',
  artifactsOrigin: 'server',
} as const;
const INTEGRATOR_INIT = { ...INTEGRATOR, artifactsOrigin: 0 };
const BOUND_MS = 200;
const TIMED_OUT: unique symbol = Symbol('timed out');

clockForFile(FRESH_NOW);

const bucket = serveBucket(METHOD_AADHAAR_BUCKET_CHUNKED);

beforeEach(() => {
  for (const call of Object.values(core)) call.mockReset();
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The value, or `TIMED_OUT` when it does not settle within `ms`. */
const within = <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> =>
  Promise.race([work, sleep(ms).then((): typeof TIMED_OUT => TIMED_OUT)]);

/** A promise the test settles by hand. */
function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
}

/** The method folder and the stack loaded afresh, so no checked pair and no binding of an earlier test is in memory. */
async function fresh() {
  vi.resetModules();

  const { anonAadhaarMethod } = await import('../../src/method-aadhaar');
  const { coreStack } = await import('../../src/method-aadhaar/stack');

  return { anonAadhaarMethod, coreStack };
}

/** Every argument the peer's `init` received, in order. */
const initArgs = (): unknown[] => core.init.mock.calls.map(([args]) => args);

/** The peer's `prove` held pending until the test settles it, once. */
function pendingProof(): (pcd: unknown) => void {
  const proof = deferred<unknown>();

  core.prove.mockImplementationOnce(() => proof.promise);

  return proof.resolve;
}

/** The peer's `generateArgs` held pending until the test settles it, once. */
function pendingArgs(): (args: unknown) => void {
  const args = deferred<unknown>();

  core.generateArgs.mockImplementationOnce(() => args.promise);

  return args.resolve;
}

const BUSY = [
  ['the default stack', 'default'],
  ['an integrator stack', 'integrator'],
] as const;

/** A stack over `busyFiles` and one over the other files, both loaded with the peer holding the first's, and each one's `init` argument. */
async function twoStacks(busyFiles: 'default' | 'integrator') {
  const { anonAadhaarMethod } = await fresh();
  const busy = busyFiles === 'default' ? anonAadhaarMethod() : anonAadhaarMethod({ artifacts: INTEGRATOR });
  const idle = busyFiles === 'default' ? anonAadhaarMethod({ artifacts: INTEGRATOR }) : anonAadhaarMethod();

  await idle.verify(ctx, production);
  await busy.verify(ctx, production);

  const [idleInit, busyInit] = initArgs();

  return { busy, idle, idleInit, busyInit };
}

/**
 * Starts `work` on the busy stack, waits until its `reached` peer call is pending, queues a verdict on the idle stack's other files
 * behind it, then settles the pending call; answers both calls.
 */
async function otherFilesQueued<T>(work: () => Promise<T>, reached: typeof core.prove | typeof core.generateArgs, idle: IRecoveryMethod, settle: () => void) {
  const working = work();

  await vi.waitFor(() => expect(reached).toHaveBeenCalledTimes(1));

  const judging = idle.verify(ctx, production);

  await sleep(20);

  expect(core.init).toHaveBeenCalledTimes(2);

  settle();

  return { working, judging };
}

const enrol =(method: IRecoveryMethod, material: Material = { qrData: QR_DATA }): Promise<unknown> => method.configFrom(method.enrollInput(PARAMS), material);
const reply = (method: IRecoveryMethod, material: Material = { qrData: QR_DATA }): Promise<unknown> => method.replyFrom(ctx, method.signingInput(ctx, PARAMS), material);

const RUNS = [
  ['configFrom', enrol],
  ['replyFrom', reply],
] as const;

describe('a stack whose files the peer no longer holds re-initialises it with its own before using them', () => {
  it.each(RUNS)('%s on the default stack after an integrator stack loaded: init with the checked pair first, nothing fetched again', async (_name, run) => {
    const { anonAadhaarMethod } = await fresh();
    const ours = anonAadhaarMethod();
    const theirs = anonAadhaarMethod({ artifacts: INTEGRATOR });

    expect(await ours.verify(ctx, production)).toBe('satisfied');
    expect(await theirs.verify(ctx, production)).toBe('satisfied');

    const [checked] = initArgs();
    const fetched = bucket.fetched.length;

    expect(checked).toStrictEqual(servedInit(METHOD_AADHAAR_BUCKET_CHUNKED, 2));

    core.prove.mockResolvedValueOnce(boundPcd);

    expect(typeof (await run(ours))).toBe('string');
    expect(initArgs()).toStrictEqual([checked, INTEGRATOR_INIT, checked]);
    expect(core.init.mock.invocationCallOrder[2]).toBeLessThan(core.generateArgs.mock.invocationCallOrder[0] ?? 0);
    expect(bucket.fetched).toHaveLength(fetched);
  });

  it('the integrator stack re-initialises with its own URLs after the default stack took the peer back', async () => {
    const { anonAadhaarMethod } = await fresh();
    const ours = anonAadhaarMethod();
    const theirs = anonAadhaarMethod({ artifacts: INTEGRATOR });

    await theirs.verify(ctx, production);
    await ours.verify(ctx, production);

    const [, checked] = initArgs();

    expect(await theirs.verify(ctx, production)).toBe('satisfied');
    expect(initArgs()).toStrictEqual([INTEGRATOR_INIT, checked, INTEGRATOR_INIT]);
    expect(core.init.mock.invocationCallOrder[2]).toBeLessThan(core.verify.mock.invocationCallOrder[2] ?? 0);
  });

  it('two default stacks share the files and never re-initialise each other, in turn or at once', async () => {
    const { anonAadhaarMethod } = await fresh();
    const first = anonAadhaarMethod();
    const second = anonAadhaarMethod();

    await first.verify(ctx, production);
    await second.verify(ctx, production);

    const loaded = core.init.mock.calls.length;

    core.prove.mockResolvedValue(boundPcd);

    for (const method of [first, second, first, second]) expect(typeof (await reply(method))).toBe('string');

    await Promise.all([first.verify(ctx, production), second.verify(ctx, production), enrol(first), enrol(second)]);

    expect(loaded).toBeLessThanOrEqual(2);
    expect(core.init).toHaveBeenCalledTimes(loaded);

    for (const args of initArgs()) expect(args).toStrictEqual(initArgs()[0]);
  });
});

describe('two stacks with different files take turns on the peer', () => {
  it.each([
    ['an integrator stack used for the first time waits for the default stack\'s pending proof', 'default', false],
    ['an integrator stack loaded before waits for the default stack\'s pending proof', 'default', true],
    ['a default stack used for the first time waits for the integrator stack\'s pending proof', 'integrator', false],
    ['a default stack loaded before waits for the integrator stack\'s pending proof', 'integrator', true],
  ] as const)('%s, then inits with its own files and runs', async (_why, busyFiles, idleLoaded) => {
    const { anonAadhaarMethod } = await fresh();
    const busy = busyFiles === 'default' ? anonAadhaarMethod() : anonAadhaarMethod({ artifacts: INTEGRATOR });
    const idle = busyFiles === 'default' ? anonAadhaarMethod({ artifacts: INTEGRATOR }) : anonAadhaarMethod();

    if (idleLoaded) expect(await idle.verify(ctx, production)).toBe('satisfied');

    expect(await busy.verify(ctx, production)).toBe('satisfied');

    const finish = pendingProof();
    const enrolling = enrol(busy);

    await vi.waitFor(() => expect(core.prove).toHaveBeenCalledTimes(1));

    const inits = core.init.mock.calls.length;
    const verifies = core.verify.mock.calls.length;
    const judging = idle.verify(ctx, production);

    await sleep(20);

    expect(core.init).toHaveBeenCalledTimes(inits);
    expect(core.verify).toHaveBeenCalledTimes(verifies);

    finish(boundPcd);

    expect(await enrolling).toBe(configBytes(22n, 77n));
    expect(await within(judging, BOUND_MS)).toBe('satisfied');
    expect(core.init).toHaveBeenCalledTimes(inits + 1);
    expect(initArgs().at(-1)).toStrictEqual(busyFiles === 'default' ? INTEGRATOR_INIT : servedInit(METHOD_AADHAAR_BUCKET_CHUNKED, 2));
    expect(core.verify).toHaveBeenCalledTimes(verifies + 1);
  });

  it('calls under the files the peer holds run at once beside a pending proof, from the same stack or another default stack', async () => {
    const { anonAadhaarMethod } = await fresh();
    const first = anonAadhaarMethod();
    const second = anonAadhaarMethod();

    await first.verify(ctx, production);

    const finish = pendingProof();
    const enrolling = enrol(first);

    await vi.waitFor(() => expect(core.prove).toHaveBeenCalledTimes(1));

    expect(await within(first.verify(ctx, production), BOUND_MS)).toBe('satisfied');
    expect(await within(second.verify(ctx, production), BOUND_MS)).toBe('satisfied');

    finish(boundPcd);

    expect(await enrolling).toBe(configBytes(22n, 77n));
  });

  it.each([
    ['the same default stack', false],
    ['another default stack', true],
  ] as const)('first come, first served: with A1 pending under the bucket files and B queued with other files, A2 on %s waits behind B; B inits and runs, then A2 inits and runs', async (_where, another) => {
    const { coreStack } = await fresh();
    const first = coreStack(METHOD_AADHAAR_BUCKET_CHUNKED);
    const second = another ? coreStack(METHOD_AADHAAR_BUCKET_CHUNKED) : first;
    const theirs = coreStack(INTEGRATOR);

    await theirs.verify(boundPcd, false);
    await first.verify(boundPcd, false);
    await second.verify(boundPcd, false);

    const trace: string[] = [];
    const held = deferred<unknown>();
    const filesOf = (args: unknown): string => (String((args as { readonly wasmURL: unknown }).wasmURL).startsWith('blob:') ? 'A' : 'B');

    core.init.mockImplementation((args) => {
      trace.push(`init ${filesOf(args)}`);

      return Promise.resolve();
    });
    core.prove.mockImplementation((args) => {
      const { from } = args as { readonly from: string };

      trace.push(`prove ${from}`);

      return from === 'A1' ? held.promise : Promise.resolve(boundPcd);
    });

    const proofs = [first.prove({ from: 'A1' })];

    await vi.waitFor(() => expect(trace).toStrictEqual(['prove A1']));

    proofs.push(theirs.prove({ from: 'B' }), second.prove({ from: 'A2' }));

    await sleep(20);

    expect(trace).toStrictEqual(['prove A1']);

    held.resolve(boundPcd);

    expect(await Promise.all(proofs)).toStrictEqual([boundPcd, boundPcd, boundPcd]);
    expect(trace).toStrictEqual(['prove A1', 'init B', 'prove B', 'init A', 'prove A2']);
  });
});

describe('a waiting prove whose signal aborts never reaches the peer', () => {
  it('replyFrom on the integrator stack, aborted while the default stack\'s proof is pending, is device-refused at once and the peer proves once', async () => {
    const { anonAadhaarMethod } = await fresh();
    const ours = anonAadhaarMethod();
    const theirs = anonAadhaarMethod({ artifacts: INTEGRATOR });

    await theirs.verify(ctx, production);
    await ours.verify(ctx, production);

    const finish = pendingProof();
    const enrolling = enrol(ours);

    await vi.waitFor(() => expect(core.prove).toHaveBeenCalledTimes(1));

    const controller = new AbortController();
    const replying = reply(theirs, { qrData: QR_DATA, signal: controller.signal });

    await sleep(20);

    expect(core.generateArgs).toHaveBeenCalledTimes(1);

    controller.abort();

    expect(isFailure(await within(replying, BOUND_MS), 'device-refused')).toBe(true);

    finish(boundPcd);

    expect(await enrolling).toBe(configBytes(22n, 77n));

    await sleep(20);

    expect(core.prove).toHaveBeenCalledTimes(1);
  });

  it('the stack\'s own prove, aborted while it waits for the other files\' proof, never calls the peer\'s prove', async () => {
    const { coreStack } = await fresh();
    const ours = coreStack(METHOD_AADHAAR_BUCKET_CHUNKED);
    const theirs = coreStack(INTEGRATOR);

    expect(await theirs.verify(boundPcd, false)).toBe(true);

    const finish = pendingProof();
    const proving = ours.prove({ from: 'ours' });

    await vi.waitFor(() => expect(core.prove).toHaveBeenCalledTimes(1));

    const controller = new AbortController();
    const waiting = theirs.prove({ from: 'theirs' }, undefined, controller.signal).then(
      () => 'proved',
      () => 'refused',
    );

    await sleep(20);
    controller.abort();
    finish(boundPcd);

    expect(await proving).toBe(boundPcd);
    expect(await within(waiting, BOUND_MS)).toBe('refused');
    expect(core.prove.mock.calls.map(([args]) => args)).toEqual([{ from: 'ours' }]);
  });
});

describe('a failed re-initialisation', () => {
  it.each(RUNS)('%s is device-unavailable without a peer call, and the next call inits again and proves', async (_name, run) => {
    const { anonAadhaarMethod } = await fresh();
    const ours = anonAadhaarMethod();
    const theirs = anonAadhaarMethod({ artifacts: INTEGRATOR });

    await ours.verify(ctx, production);
    await theirs.verify(ctx, production);

    const [checked] = initArgs();

    core.init.mockRejectedValueOnce(new Error('init failed'));

    expect(isFailure(await run(ours), 'device-unavailable')).toBe(true);
    expect(core.generateArgs).not.toHaveBeenCalled();
    expect(core.prove).not.toHaveBeenCalled();

    core.prove.mockResolvedValueOnce(boundPcd);

    expect(typeof (await run(ours))).toBe('string');
    expect(initArgs()).toStrictEqual([checked, INTEGRATOR_INIT, checked, checked]);
  });

  it('leaves the files unknown: the stack the peer held before also inits again on its next call', async () => {
    const { anonAadhaarMethod } = await fresh();
    const ours = anonAadhaarMethod();
    const theirs = anonAadhaarMethod({ artifacts: INTEGRATOR });

    await ours.verify(ctx, production);
    await theirs.verify(ctx, production);

    const [checked] = initArgs();

    core.init.mockRejectedValueOnce(new Error('init failed'));

    expect(isFailure(await enrol(ours), 'device-unavailable')).toBe(true);
    expect(await theirs.verify(ctx, production)).toBe('satisfied');
    expect(initArgs()).toStrictEqual([checked, INTEGRATOR_INIT, checked, INTEGRATOR_INIT]);
  });

  it.each(BUSY)('replyFrom on %s, refused its init before verifying once a stack with other files took its turn, is device-unavailable with no peer verify, and the next call inits again', async (_name, busyFiles) => {
    const { busy, idle, idleInit, busyInit } = await twoStacks(busyFiles);

    core.init.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('init failed'));

    const finish = pendingProof();
    const { working, judging } = await otherFilesQueued(() => reply(busy), core.prove, idle, () => finish(boundPcd));

    expect(isFailure(await working, 'device-unavailable')).toBe(true);
    expect(await judging).toBe('satisfied');
    expect(initArgs()).toStrictEqual([idleInit, busyInit, idleInit, busyInit]);
    expect(core.verify).toHaveBeenCalledTimes(3);

    core.prove.mockResolvedValueOnce(boundPcd);

    expect(typeof (await reply(busy))).toBe('string');
    expect(initArgs()).toStrictEqual([idleInit, busyInit, idleInit, busyInit, busyInit]);
    expect(core.verify).toHaveBeenCalledTimes(4);
  });

  it.each(BUSY)('replyFrom on %s, granted its init before verifying after the same turns but thrown at by the peer verify, still reads not-judged and hands the proof on', async (_name, busyFiles) => {
    const { busy, idle, idleInit, busyInit } = await twoStacks(busyFiles);

    core.verify.mockResolvedValueOnce(true).mockRejectedValueOnce(new Error('unknown issuer key'));

    const finish = pendingProof();
    const { working, judging } = await otherFilesQueued(() => reply(busy), core.prove, idle, () => finish(boundPcd));

    expect(typeof (await working)).toBe('string');
    expect(await judging).toBe('satisfied');
    expect(initArgs()).toStrictEqual([idleInit, busyInit, idleInit, busyInit]);
    expect(core.verify).toHaveBeenCalledTimes(4);
  });

  it.each(RUNS)('%s, refused its init before proving once a stack with other files took its turn after the arguments, is device-unavailable and never proves', async (_name, run) => {
    const { busy, idle, idleInit, busyInit } = await twoStacks('default');

    core.init.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('init failed'));

    const settle = pendingArgs();
    const { working, judging } = await otherFilesQueued(() => run(busy), core.generateArgs, idle, () => settle({}));

    expect(isFailure(await working, 'device-unavailable')).toBe(true);
    expect(await judging).toBe('satisfied');
    expect(core.prove).not.toHaveBeenCalled();
    expect(initArgs()).toStrictEqual([idleInit, busyInit, idleInit, busyInit]);
  });

  it('the method\'s own verify keeps its three verdicts: an init refused before the peer verifies reads not-judged', async () => {
    const { idle } = await twoStacks('default');

    core.init.mockRejectedValueOnce(new Error('init failed'));

    expect(await idle.verify(ctx, production)).toBe('not-judged');
    expect(core.verify).toHaveBeenCalledTimes(2);
  });
});

describe('the turns on the peer, documented', () => {
  const TYPES = join(SRC_ROOT, 'types', 'method-aadhaar.ts');
  const flat = (text: string): string => text.replace(/\s*\n\s*\*?\s*/g, ' ');

  it('coreStack says two stacks with different files take turns on the page-global peer', () => {
    expect(flat(jsDocOf(join(SRC_ROOT, 'method-aadhaar', 'stack.ts'), 'coreStack'))).toMatch(/turns/i);
  });

  it('the artifacts\' JSDoc says stacks take turns, no longer that the last init sets the files every stack proves with', () => {
    const doc = flat([jsDocOf(TYPES, 'AnonAadhaarArtifacts'), jsDocOf(TYPES, 'artifacts', 'AnonAadhaarMethodOptions')].join('\n'));

    expect(doc).toMatch(/turns/i);
    expect(doc).not.toMatch(/last `?init`? on the page sets the files/i);
  });

  it('the bucket check says its one checked pair per page is never revoked', () => {
    expect(flat(jsDocOf(join(SRC_ROOT, 'method-aadhaar', 'artifacts.ts'), 'pinnedArtifacts'))).toMatch(/revoke/i);
  });

  it('the artifact checks\' changeset says both: stacks take turns, and the pair is kept for the page', () => {
    const text = flat(readFileSync(join(REPO_ROOT, '.changeset', 'aadhaar-artifact-checks.md'), 'utf8'));

    expect(text).toMatch(/turns/i);
    expect(text).toMatch(/revoke/i);
  });

  /** Whether one sentence of the text matches both patterns. */
  const inOneSentence = (text: string, first: RegExp, second: RegExp): boolean =>
    flat(text)
      .split(/(?<=\.)\s+/)
      .some((sentence) => first.test(sentence) && second.test(sentence));

  it('replyFrom says a stack that cannot initialise before its local verdict is device-unavailable', () => {
    expect(inOneSentence(jsDocOf(join(SRC_ROOT, 'method-aadhaar', 'method.ts'), 'replyFrom'), /verdict/i, /device-unavailable/)).toBe(true);
  });

  it('the artifact checks\' changeset says the init before the reply\'s local verdict reads device-unavailable, and any other verify throw not-judged', () => {
    const text = readFileSync(join(REPO_ROOT, '.changeset', 'aadhaar-artifact-checks.md'), 'utf8');

    expect(inOneSentence(text, /verdict/i, /device-unavailable/)).toBe(true);
    expect(inOneSentence(text, /device-unavailable/, /not-judged/)).toBe(true);
  });
});

import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { METHOD_AADHAAR_BUCKET_CHUNKED, METHOD_AADHAAR_BUCKET_SERVER } from '../../src/constants/method-aadhaar-bucket';
import type { Hex } from '../../src/interfaces';
import type { Stack } from './fixtures';
import { CERTIFICATE, pcdOf, signalsFor, SYNTHETIC_UPSTREAM } from './fixtures';
import { serveBucket } from './served-bucket';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const core = vi.hoisted(() => ({
  init: vi.fn<(args: unknown) => Promise<void>>(),
  generateArgs: vi.fn<(options: unknown) => Promise<unknown>>(),
  prove: vi.fn<(args: unknown, onProgress?: (state: string) => void) => Promise<unknown>>(),
  verify: vi.fn<(pcd: unknown, testMode?: boolean) => Promise<boolean>>(),
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

const bucket = serveBucket(METHOD_AADHAAR_BUCKET_CHUNKED);

const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const pcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST));
const ORIGINS = { server: 0, local: 1, chunked: 2 } as const;
const SETTLE_MS = 2_000;
const TIMED_OUT: unique symbol = Symbol('timed out');

/** Two default stacks over the chunked bucket, one over the server bucket (the same checked pair, another zkey) and one over the integrator's paths. */
const FILES = [
  METHOD_AADHAAR_BUCKET_CHUNKED,
  METHOD_AADHAAR_BUCKET_CHUNKED,
  METHOD_AADHAAR_BUCKET_SERVER,
  { wasmURL: '/srv/aadhaar/circuit.wasm', zkeyURL: '/srv/aadhaar/circuit_final.zkey', vkeyURL: '/srv/aadhaar/vkey.json', artifactsOrigin: 'local' },
] as const;

type InitArgument = { readonly wasmURL: string; readonly zkeyURL: string; readonly vkeyURL: string; readonly artifactsOrigin: number };

/** The files an `init` argument names, the checked bucket pair standing for the bucket whatever its object URLs. */
const filesOf = ({ wasmURL, zkeyURL, vkeyURL, artifactsOrigin }: InitArgument): string =>
  wasmURL.startsWith('blob:') ? `bucket ${zkeyURL} ${artifactsOrigin}` : `${wasmURL} ${zkeyURL} ${vkeyURL} ${artifactsOrigin}`;

/** The files each stack must find the peer holding when one of its calls reaches it. */
const WANTED = FILES.map((files) =>
  files.wasmURL === METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL
    ? `bucket ${files.zkeyURL} ${ORIGINS[files.artifactsOrigin]}`
    : filesOf({ ...files, artifactsOrigin: ORIGINS[files.artifactsOrigin] }),
);

type Call = 'generateArgs' | 'prove' | 'verify';

type Op = { readonly stack: number; readonly call: Call; readonly aborts: boolean };

/** Who made a peer call: the stack, and the op of the interleaving or `-1` while the stacks load. */
type Tag = { readonly stack: number; readonly op: number };

const opArb: fc.Arbitrary<Op> = fc.record({
  stack: fc.nat({ max: FILES.length - 1 }),
  call: fc.constantFrom<Call>('generateArgs', 'prove', 'verify'),
  aborts: fc.boolean(),
});

/** What the peer double saw: every broken rule, the checked pairs it was handed, and how many `init` calls it failed. */
type Watch = { readonly broken: string[]; readonly pairs: Set<string>; failedInits: number; scheduler: fc.Scheduler | undefined };

/**
 * Makes the mocked peer answer at once while the stacks load, then through the scheduler once `watch.scheduler` is set, as the
 * page-global peer whose `init` stores its argument. It records a call reaching it under files other than its stack's, an `init`
 * swapping the files under a call in flight and a prove whose signal had already aborted, and fails the scheduled `init` calls
 * whose ordinals are listed.
 */
function watchedPeer(failing: readonly number[], signals: readonly (AbortSignal | undefined)[]): Watch {
  const watch: Watch = { broken: [], pairs: new Set(), failedInits: 0, scheduler: undefined };
  const running: string[] = [];
  let held: string | undefined;
  let inits = 0;

  const run = <T>(files: string, label: string, answer: () => T): Promise<T> => {
    running.push(files);

    return (watch.scheduler?.schedule(Promise.resolve(), label) ?? Promise.resolve()).then(answer).finally(() => {
      running.splice(running.indexOf(files), 1);
    });
  };

  core.init.mockImplementation((args) => {
    const argument = args as InitArgument;
    const files = filesOf(argument);
    const others = running.filter((other) => other !== files);
    const fails = watch.scheduler !== undefined && failing.includes(inits);

    if (others.length > 0) watch.broken.push(`init with ${files} while ${others.join(', ')} ran`);

    if (argument.wasmURL.startsWith('blob:')) watch.pairs.add(`${argument.wasmURL} ${argument.vkeyURL}`);

    if (watch.scheduler !== undefined) inits += 1;

    held = files;

    return run(files, `init ${files}`, () => {
      if (!fails) return;

      held = undefined;
      watch.failedInits += 1;

      throw new Error('init failed');
    });
  });

  const reach = <T>(name: Call, { stack, op }: Tag, answer: T): Promise<T> => {
    const wanted = WANTED[stack] ?? 'no stack';

    if (held !== wanted) watch.broken.push(`${name} of op ${op} (stack ${stack}) under ${held ?? 'unknown files'}`);

    if (name === 'prove' && signals[op]?.aborted === true) watch.broken.push(`prove of op ${op} after its signal aborted`);

    return run(wanted, `${name} of op ${op}`, () => answer);
  };

  core.generateArgs.mockImplementation((options) => reach('generateArgs', JSON.parse((options as { qrData: string }).qrData) as Tag, { circuit: 'args' }));
  core.prove.mockImplementation((args) => reach('prove', args as Tag, pcd));
  core.verify.mockImplementation((proof) => reach('verify', proof as Tag, true));

  return watch;
}

const callOn = (stack: Stack, tag: Tag, call: Call, signal: AbortSignal | undefined): Promise<unknown> => {
  if (call === 'generateArgs') return stack.generateArgs({ qrData: JSON.stringify(tag), certificateFile: CERTIFICATE, nullifierSeed: 77n, fieldsToRevealArray: [] });

  if (call === 'prove') return stack.prove({ ...tag }, undefined, signal);

  return stack.verify({ ...pcd, ...tag }, false);
};

const stackAt = (stacks: readonly Stack[], index: number): Stack => {
  const stack = stacks[index];

  if (stack === undefined) throw new RangeError(`no stack ${index}`);

  return stack;
};

const wasmFetches = (): number => bucket.fetched.filter((url) => url === METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL).length;

describe('stacks over different files share the page-global peer, over any interleaving', () => {
  it('no call reaches the peer under other files, no init swaps the files under a call in flight, an aborted waiting prove never reaches it, every call settles', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.scheduler(),
        fc.shuffledSubarray([0, 1, 2, 3], { minLength: FILES.length }),
        fc.array(opArb, { minLength: 1, maxLength: 8 }),
        fc.uniqueArray(fc.nat({ max: 7 }), { maxLength: 2 }),
        async (s, loadOrder, ops, failing) => {
          vi.resetModules();

          const { coreStack } = await import('../../src/method-aadhaar/stack');
          const stacks = FILES.map((files) => coreStack(files));
          const controllers = ops.map(({ call, aborts }) => (call === 'prove' && aborts ? new AbortController() : undefined));
          const watch = watchedPeer(failing, controllers.map((controller) => controller?.signal));
          const fetchedBefore = wasmFetches();

          for (const stack of loadOrder) await callOn(stackAt(stacks, stack), { stack, op: -1 }, 'verify', undefined);

          watch.scheduler = s;

          const runs = ops.map(({ stack, call }, op) =>
            s.schedule(Promise.resolve(), `start op ${op}`).then(() => callOn(stackAt(stacks, stack), { stack, op }, call, controllers[op]?.signal)),
          );
          const aborts = controllers.flatMap((controller) =>
            controller === undefined ? [] : [s.schedule(Promise.resolve(), 'abort').then(() => controller.abort())],
          );
          const outcomes = await Promise.race([
            s.waitFor(Promise.all([Promise.allSettled(runs), Promise.all(aborts)]).then(([settled]) => settled)),
            new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), SETTLE_MS)),
          ]);

          expect(outcomes, s.report().map((task) => task.label).join(' > ')).not.toBe(TIMED_OUT);
          expect(watch.broken).toEqual([]);
          expect(watch.pairs.size).toBeLessThanOrEqual(1);
          expect(wasmFetches() - fetchedBefore).toBeLessThanOrEqual(1);

          if (outcomes === TIMED_OUT) return;

          outcomes.forEach((outcome, op) => {
            if (watch.failedInits === 0 && controllers[op] === undefined) expect(outcome.status, `op ${op}`).toBe('fulfilled');
          });
        },
      ),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, Math.max(60_000, NUM_RUNS * 100));
});

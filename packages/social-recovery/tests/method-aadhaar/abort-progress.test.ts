import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hex, Material } from '../../src/interfaces';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import { jsDocOf, REPO_ROOT, SRC_ROOT } from '../helpers/source';
import type { Stack } from './fixtures';
import { CERTIFICATE, clockForFile, configBytes, ctxFor, FRESH_NOW, isFailure, pcdOf, QR_DATA, signalsFor, SYNTHETIC_UPSTREAM } from './fixtures';

type Progress = Parameters<Stack['prove']>[1];
type Pcd = Awaited<ReturnType<Stack['prove']>>;

/** The proof vector's digest. */
const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const ctx = ctxFor(configBytes(22n, 77n), DIGEST);
const boundPcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST));
const BOUND_MS = 200;
const TIMED_OUT: unique symbol = Symbol('timed out');

clockForFile(FRESH_NOW);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A JSDoc block or a changeset on one line, its line breaks and leading asterisks gone. */
const flat = (text: string): string => text.replace(/\s*\n\s*\*?\s*/g, ' ');

/** The settled half of the progress contract: no state after the call settles, whatever ended it. */
const SETTLES = /\bcall (?:settles|has settled)\b/i;

/** The value, or `TIMED_OUT` when it does not settle within `ms`. */
const within = <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> =>
  Promise.race([work, sleep(ms).then((): typeof TIMED_OUT => TIMED_OUT)]);

type SteppedStack = {
  readonly stack: Stack;
  /** Resolves once `prove` has been entered. */
  readonly proving: Promise<void>;
  /** Calls the callback the stack received, as the installed stack reports a state over time. */
  readonly emit: (state: string) => void;
  /** Settles the pending `prove` with a proof. */
  readonly finish: (pcd: Pcd) => void;
  /** Rejects the pending `prove`, as a stack whose witness fails. */
  readonly fail: (error: unknown) => void;
  readonly received: () => Progress;
  readonly signals: (AbortSignal | undefined)[];
  readonly verifyCalls: () => number;
  /** Whether `prove` has settled. */
  readonly settled: () => boolean;
};

/** A stack whose `prove` stays pending until the test finishes it and reports states only when the test emits them. */
function steppedStack(): SteppedStack {
  let received: Progress;
  let settle: (pcd: Pcd) => void = () => undefined;
  let refuse: (error: unknown) => void = () => undefined;
  let entered: () => void = () => undefined;
  let done = false;
  let verifies = 0;
  const signals: (AbortSignal | undefined)[] = [];
  const proving = new Promise<void>((resolve) => {
    entered = resolve;
  });

  const stack: Stack = {
    generateArgs: () => Promise.resolve({ circuitArguments: 'from the stepped stack' }),
    prove: (_args, onProgress, signal) => {
      received = onProgress;
      signals.push(signal);
      entered();

      return new Promise<Pcd>((resolve, reject) => {
        settle = (pcd) => {
          done = true;
          resolve(pcd);
        };
        refuse = (error) => {
          done = true;
          reject(error);
        };
      });
    },
    verify: () => {
      verifies += 1;

      return Promise.resolve(true);
    },
  };

  return {
    stack,
    proving,
    emit: (state) => received?.(state),
    finish: (pcd) => settle(pcd),
    fail: (error) => refuse(error),
    received: () => received,
    signals,
    verifyCalls: () => verifies,
    settled: () => done,
  };
}

/** The page's progress callback and the states it saw. */
function page(): { readonly onProgress: (state: string) => void; readonly states: string[] } {
  const states: string[] = [];

  return {
    onProgress: (state) => {
      states.push(state);
    },
    states,
  };
}

let unhandled = 0;
const countUnhandled = (): void => {
  unhandled += 1;
};

beforeEach(() => {
  unhandled = 0;
  process.on('unhandledRejection', countUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', countUnhandled);
});

type Run = (stack: Stack, material: Material) => Promise<unknown>;

const RUNS: readonly (readonly [string, Run])[] = [
  [
    'replyFrom',
    (stack, material) => {
      const method = anonAadhaarMethod({ stack });

      return method.replyFrom(ctx, method.signingInput(ctx, PARAMS), material);
    },
  ],
  [
    'configFrom',
    (stack, material) => {
      const method = anonAadhaarMethod({ stack });

      return method.configFrom(method.enrollInput(PARAMS), material);
    },
  ],
];

describe('an aborted proof forwards no more progress', () => {
  it.each(RUNS)('%s: the states before the abort reach the page, none after it', async (_name, run) => {
    const stepped = steppedStack();
    const controller = new AbortController();
    const seen = page();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal: controller.signal });

    await stepped.proving;
    stepped.emit('fetching-wasm');
    stepped.emit('fetching-zkey');
    controller.abort();
    stepped.emit('proving');
    stepped.emit('completed');

    expect(isFailure(await within(pending, BOUND_MS), 'device-refused')).toBe(true);
    expect(seen.states).toEqual(['fetching-wasm', 'fetching-zkey']);
  });

  it.each(RUNS)('%s settles device-refused at once while the stack\'s prove is still pending', async (_name, run) => {
    const stepped = steppedStack();
    const controller = new AbortController();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: page().onProgress, signal: controller.signal });

    await stepped.proving;
    controller.abort();

    const result = await within(pending, BOUND_MS);

    expect(result).not.toBe(TIMED_OUT);
    expect(isFailure(result, 'device-refused')).toBe(true);
    expect(stepped.settled()).toBe(false);
  });

  it.each(RUNS)('%s ignores the stack\'s later proof and its later states: still device-refused, no verify, nothing more on the page', async (_name, run) => {
    const stepped = steppedStack();
    const controller = new AbortController();
    const seen = page();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal: controller.signal });

    await stepped.proving;
    stepped.emit('proving');
    controller.abort();

    const result = await within(pending, BOUND_MS);

    stepped.emit('completed');
    stepped.finish(boundPcd);
    await sleep(20);

    expect(isFailure(result, 'device-refused')).toBe(true);
    expect(isFailure(await pending, 'device-refused')).toBe(true);
    expect(seen.states).toEqual(['proving']);
    expect(stepped.verifyCalls()).toBe(0);
    expect(unhandled).toBe(0);
  });

  it.each(RUNS)('%s: the stack receives the signal and a callback of its own, which forwards to the page while the signal is live', async (_name, run) => {
    const stepped = steppedStack();
    const controller = new AbortController();
    const seen = page();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal: controller.signal });

    await stepped.proving;

    expect(stepped.signals).toEqual([controller.signal]);
    expect(stepped.received()).toEqual(expect.any(Function));
    expect(stepped.received()).not.toBe(seen.onProgress);

    stepped.emit('proving');
    stepped.emit('completed');
    stepped.finish(boundPcd);

    expect(typeof (await within(pending, BOUND_MS))).toBe('string');
    expect(seen.states).toEqual(['proving', 'completed']);
  });
});

/** A proof the method refuses: another nullifier and another seed than the config and the enrollment carry. */
const unboundPcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(23n, 78n, DIGEST));
const PEER_FAILURE = '[AnonAAdhaarProver]: Error while generating the proof';

/** How the stack ends the proof, whether a live signal rides along, and what the call then returns. */
const SETTLEMENTS: readonly (readonly [string, boolean, (stepped: SteppedStack) => void, 'a proof' | 'material-rejected'])[] = [
  ['a proof, no signal', false, (stepped) => stepped.finish(boundPcd), 'a proof'],
  ['a proof, a live signal', true, (stepped) => stepped.finish(boundPcd), 'a proof'],
  ['a proof the method refuses, no signal', false, (stepped) => stepped.finish(unboundPcd), 'material-rejected'],
  ['a proof the method refuses, a live signal', true, (stepped) => stepped.finish(unboundPcd), 'material-rejected'],
  ['a rejection, no signal', false, (stepped) => stepped.fail(new Error(PEER_FAILURE)), 'material-rejected'],
  ['a rejection, a live signal', true, (stepped) => stepped.fail(new Error(PEER_FAILURE)), 'material-rejected'],
];

const SETTLED = RUNS.flatMap(([name, run]) => SETTLEMENTS.map(([why, live, settle, outcome]) => [name, why, run, live, settle, outcome] as const));

describe('a settled call forwards no more progress', () => {
  it.each(SETTLED)('%s, %s: the state before settlement reaches the page once, none the stack reports after it', async (_name, _why, run, live, settle, outcome) => {
    const stepped = steppedStack();
    const seen = page();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, ...(live ? { signal: new AbortController().signal } : {}) });

    await stepped.proving;
    stepped.emit('proving');
    settle(stepped);

    const result = await within(pending, BOUND_MS);

    stepped.emit('completed');
    stepped.emit('error');
    await sleep(20);

    expect(outcome === 'a proof' ? typeof result === 'string' : isFailure(result, outcome)).toBe(true);
    expect(seen.states).toEqual(['proving']);
    expect(unhandled).toBe(0);
  });
});

/** A signal whose `aborted` getter reads false until `explode` is called, then throws on every read. */
function explodingSignal(): { readonly signal: AbortSignal; readonly explode: () => void } {
  let exploded = false;
  const signal = {
    get aborted(): boolean {
      if (exploded) throw new Error('aborted getter exploded');

      return false;
    },
    addEventListener(): void {},
    removeEventListener(): void {},
  } as unknown as AbortSignal;

  return {
    signal,
    explode: () => {
      exploded = true;
    },
  };
}

describe('a signal whose getter throws during the proof', () => {
  it.each(RUNS)('%s forwards nothing once the getter throws and settles material-rejected', async (_name, run) => {
    const stepped = steppedStack();
    const { signal, explode } = explodingSignal();
    const seen = page();
    const pending = run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal });

    await stepped.proving;
    stepped.emit('fetching-wasm');
    explode();
    stepped.emit('proving');
    stepped.emit('completed');
    stepped.finish(boundPcd);

    const result = await within(pending, BOUND_MS);

    expect(isFailure(result, 'material-rejected')).toBe(true);
    expect(seen.states).toEqual(['fetching-wasm']);
    await sleep(20);
    expect(unhandled).toBe(0);
  });

  it.each(RUNS)('%s: a getter throwing from the first read forwards nothing and asks no stack', async (_name, run) => {
    const stepped = steppedStack();
    const { signal, explode } = explodingSignal();
    const seen = page();

    explode();

    const result = await within(run(stepped.stack, { qrData: QR_DATA, onProgress: seen.onProgress, signal }), BOUND_MS);

    expect(isFailure(result, 'material-rejected')).toBe(true);
    expect(seen.states).toEqual([]);
    expect(stepped.signals).toEqual([]);
  });
});

describe('the abort contract, documented where the page and an injected stack read it', () => {
  const TYPES = join(SRC_ROOT, 'types', 'method-aadhaar.ts');

  it('the material\'s signal says an abort is device-refused at once, that the SDK starts no worker and that the stack runs on', () => {
    const doc = jsDocOf(TYPES, 'signal', 'AadhaarMaterial');

    expect(doc).toContain('device-refused');
    expect(doc).toMatch(/no worker/i);
    expect(doc).toMatch(/progress/i);
  });

  it('the stack\'s prove says the installed stack runs on after an abort and an injected one may stop on the signal', () => {
    const doc = jsDocOf(TYPES, 'prove', 'AnonAadhaarStack');

    expect(doc).toMatch(/abort/i);
    expect(doc).toMatch(/injected/i);
  });

  it.each([
    ['runProver', join(SRC_ROOT, 'method-aadhaar', 'prover.ts'), undefined],
    ['gatedProgress', join(SRC_ROOT, 'method-aadhaar', 'prover.ts'), undefined],
    ['signal', TYPES, 'AadhaarMaterial'],
    ['prove', TYPES, 'AnonAadhaarStack'],
    ['replyFrom', join(SRC_ROOT, 'method-aadhaar', 'method.ts'), 'AnonAadhaarMethod'],
    ['anonAadhaarMethod', join(SRC_ROOT, 'method-aadhaar', 'factory.ts'), undefined],
  ] as const)('%s says progress stops once the call settles, not only on an abort', (name, path, within) => {
    expect(flat(jsDocOf(path, name, within))).toMatch(SETTLES);
  });
});

describe('the abort contract\'s changeset', () => {
  const text = readFileSync(join(REPO_ROOT, '.changeset', 'aadhaar-abort-contract.md'), 'utf8');

  it('is a patch for the package that states what an abort stops and carries a Compatibility line', () => {
    expect(text).toMatch(/^---\n"@kohaku-eth\/social-recovery": patch\n---\n/);
    expect(text).toContain('device-refused');
    expect(text).toMatch(/no worker/i);
    expect(text).toContain('Compatibility');
    expect(text).not.toMatch(/^\s*(\*\*)?breaking/im);
  });

  it('says progress stops once the call settles', () => {
    expect(flat(text)).toMatch(SETTLES);
  });

  it('names the recovery-methods entry as the one exporting the factory, never both entries', () => {
    expect(text).toMatch(/recovery-methods/);
    expect(text).not.toMatch(/both entries/i);
  });
});

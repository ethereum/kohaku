import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Hex, Material } from '../../src/interfaces';
import { REPLY_FAILURE_CAUSES } from '../../src/index';
import { anonAadhaarMethod } from '../../src/method-aadhaar';
import type { Stack, StackDouble } from './fixtures';
import { CERTIFICATE, configBytes, ctxFor, isFailure, pcdOf, QR_DATA, signalsFor, stackDouble, SYNTHETIC_UPSTREAM } from './fixtures';

/** The proof vector's digest. */
const DIGEST: Hex = '0x17498ba208aefe001e6e2f2adec41cd16d0285e23660df6e310d3daac040c339';
const PARAMS = { nullifierSeed: 77n, issuerCertificate: CERTIFICATE };
const CONFIG = configBytes(22n, 77n);
const boundPcd = pcdOf(SYNTHETIC_UPSTREAM, signalsFor(22n, 77n, DIGEST));
const ctx = ctxFor(CONFIG, DIGEST);
const BOUND_MS = 200;
const TIMED_OUT: unique symbol = Symbol('timed out');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The value, or `TIMED_OUT` when it does not settle within `ms`. */
const within = <T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> =>
  Promise.race([work, sleep(ms).then((): typeof TIMED_OUT => TIMED_OUT)]);

type Verify = Stack['verify'];

/** The double with its `verify` replaced; `entered` resolves once verify is called. */
function withVerify(double: StackDouble, make: (checked: Parameters<Verify>[0]) => ReturnType<Verify>): {
  readonly stack: Stack;
  readonly entered: Promise<void>;
  readonly calls: () => number;
} {
  let calls = 0;
  let signalEntered: () => void = () => undefined;
  const entered = new Promise<void>((resolve) => {
    signalEntered = resolve;
  });
  const verify: Verify = (checked) => {
    calls += 1;
    signalEntered();

    return make(checked);
  };

  return { stack: { ...double.stack, verify }, entered, calls: () => calls };
}

const cause = (value: unknown): unknown => (value as { cause?: unknown }).cause;
const kind = (value: unknown): unknown => (value as { kind?: unknown }).kind;

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

describe('abort covers local verification', () => {
  it(`an abort while verify never resolves settles replyFrom to device-refused within ${BOUND_MS} ms`, async () => {
    const double = stackDouble({ pcd: boundPcd });
    const wrapped = withVerify(double, () => new Promise<boolean>(() => undefined));
    const method = anonAadhaarMethod({ stack: wrapped.stack });
    const controller = new AbortController();
    const pending = method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, signal: controller.signal });

    await wrapped.entered;

    const started = Date.now();

    controller.abort();

    const reply = await within(pending, BOUND_MS);

    expect(reply).not.toBe(TIMED_OUT);
    expect(isFailure(reply, 'device-refused')).toBe(true);
    expect(Date.now() - started).toBeLessThan(BOUND_MS);
    expect(wrapped.calls()).toBe(1);
    await sleep(20);
    expect(unhandled).toBe(0);
  });

  it('an abort raised as the verifier returns false is device-refused, not material-rejected', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const controller = new AbortController();
    const wrapped = withVerify(double, () => {
      controller.abort();

      return Promise.resolve(false);
    });
    const method = anonAadhaarMethod({ stack: wrapped.stack });
    const reply = await within(
      method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, signal: controller.signal }),
      BOUND_MS,
    );

    expect(isFailure(reply, 'device-refused')).toBe(true);
    expect(wrapped.calls()).toBe(1);
  });

  it('an abort raised as the verifier throws is device-refused too', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const controller = new AbortController();
    const wrapped = withVerify(double, () => {
      controller.abort();

      return Promise.reject(new Error('VerificationError: public key mismatch.'));
    });
    const method = anonAadhaarMethod({ stack: wrapped.stack });
    const reply = await within(
      method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, signal: controller.signal }),
      BOUND_MS,
    );

    expect(isFailure(reply, 'device-refused')).toBe(true);
    await sleep(20);
    expect(unhandled).toBe(0);
  });
});

describe('a pre-aborted signal asks no prover', () => {
  it('replyFrom and configFrom are device-refused with zero prover calls', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const signal = AbortSignal.abort();
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, signal });
    const config = await method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA, signal });

    expect(isFailure(reply, 'device-refused')).toBe(true);
    expect(isFailure(config, 'device-refused')).toBe(true);
    expect(double.total()).toBe(0);
  });
});

describe('a malformed signal is the typed failure', () => {
  it('a signal lacking removeEventListener is material-rejected from both calls, zero prover calls, no unhandled rejection', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const material = { qrData: QR_DATA, signal: { aborted: false, addEventListener(): void {} } } as unknown as Material;
    const reply = await within(method.replyFrom(ctx, method.signingInput(ctx, PARAMS), material), BOUND_MS);
    const config = await within(method.configFrom(method.enrollInput(PARAMS), material), BOUND_MS);

    expect(isFailure(reply, 'material-rejected')).toBe(true);
    expect(isFailure(config, 'material-rejected')).toBe(true);
    expect(double.total()).toBe(0);
    await sleep(20);
    expect(unhandled).toBe(0);
  });

  it('a signal whose removeEventListener throws settles both calls to a typed failure, no hang, no unhandled rejection', async () => {
    const throwing = {
      aborted: false,
      addEventListener(): void {},
      removeEventListener(): void {
        throw new Error('removeEventListener exploded');
      },
    } as unknown as AbortSignal;
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const reply = await within(method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, signal: throwing }), BOUND_MS);
    const config = await within(method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA, signal: throwing }), BOUND_MS);

    for (const result of [reply, config]) {
      expect(result).not.toBe(TIMED_OUT);
      expect(kind(result)).toBe('reply-failure');
      expect(REPLY_FAILURE_CAUSES).toContain(cause(result));
      expect(isFailure(result, 'material-rejected')).toBe(true);
    }

    await sleep(20);
    expect(unhandled).toBe(0);
  });
});

/** Material whose `member` is a getter that throws on every read; the other members are valid. */
function throwingMember(member: 'qrData' | 'onProgress' | 'signal'): Material {
  const material: Record<string, unknown> = { qrData: QR_DATA, onProgress: (): void => undefined, signal: new AbortController().signal };

  Object.defineProperty(material, member, {
    enumerable: true,
    get(): never {
      throw new Error(`${member} getter exploded`);
    },
  });

  return material as unknown as Material;
}

describe('a material member whose getter throws is the typed failure, never a throw', () => {
  for (const member of ['qrData', 'onProgress', 'signal'] as const) {
    it(`a throwing ${member} getter: replyFrom and configFrom are material-rejected, zero stack calls, no unhandled rejection`, async () => {
      const double = stackDouble({ pcd: boundPcd });
      const method = anonAadhaarMethod({ stack: double.stack });
      const reply = await within(method.replyFrom(ctx, method.signingInput(ctx, PARAMS), throwingMember(member)), BOUND_MS);
      const config = await within(method.configFrom(method.enrollInput(PARAMS), throwingMember(member)), BOUND_MS);

      for (const result of [reply, config]) {
        expect(result).not.toBe(TIMED_OUT);
        expect(isFailure(result, 'material-rejected')).toBe(true);
      }

      expect(double.total()).toBe(0);
      await sleep(20);
      expect(unhandled).toBe(0);
    });
  }
});

/** A signal whose `aborted` getter reads `false` `falseReads` times, then throws on every read. */
function throwingAfter(falseReads: number): AbortSignal {
  let reads = 0;

  return {
    get aborted(): boolean {
      reads += 1;

      if (reads > falseReads) throw new Error(`aborted getter exploded on read ${reads}`);

      return false;
    },
    addEventListener(): void {},
    removeEventListener(): void {},
  } as unknown as AbortSignal;
}

describe('a throwing aborted getter is material-rejected, never a throw', () => {
  for (const falseReads of [0, 1]) {
    const label = falseReads === 0 ? 'throws on the first read' : 'reads false once, then throws';

    it(`a getter that ${label}: both calls are material-rejected, zero prover calls, no unhandled rejection`, async () => {
      const double = stackDouble({ pcd: boundPcd });
      const method = anonAadhaarMethod({ stack: double.stack });
      const reply = await within(
        method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, signal: throwingAfter(falseReads) }),
        BOUND_MS,
      );
      const config = await within(
        method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA, signal: throwingAfter(falseReads) }),
        BOUND_MS,
      );

      expect(isFailure(reply, 'material-rejected')).toBe(true);
      expect(isFailure(config, 'material-rejected')).toBe(true);
      expect(double.total()).toBe(0);
      await sleep(20);
      expect(unhandled).toBe(0);
    });
  }

  it('a getter that reads false twice, then throws: configFrom is material-rejected after exactly one prover call', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const config = await within(
      method.configFrom(method.enrollInput(PARAMS), { qrData: QR_DATA, signal: throwingAfter(2) }),
      BOUND_MS,
    );

    expect(isFailure(config, 'material-rejected')).toBe(true);
    expect(double.total()).toBe(1);
    expect(double.order).toEqual(['generateArgs']);
    await sleep(20);
    expect(unhandled).toBe(0);
  });

  it('a getter that reads false twice, then throws: replyFrom over a valid request is material-rejected', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const reply = await within(
      method.replyFrom(ctx, method.signingInput(ctx, PARAMS), { qrData: QR_DATA, signal: throwingAfter(2) }),
      BOUND_MS,
    );

    expect(reply).not.toBe(TIMED_OUT);
    expect(isFailure(reply, 'material-rejected')).toBe(true);
    await sleep(20);
    expect(unhandled).toBe(0);
  });
});

describe('the normal run is unchanged', () => {
  it('a live signal still returns the proof bytes, reports progress and verifies once', async () => {
    const double = stackDouble({ pcd: boundPcd });
    const method = anonAadhaarMethod({ stack: double.stack });
    const controller = new AbortController();
    const states: string[] = [];
    const reply = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), {
      qrData: QR_DATA,
      signal: controller.signal,
      onProgress: (state: string): void => {
        states.push(state);
      },
    });

    expect(typeof reply).toBe('string');
    expect(((reply as Hex).length - 2) / 2).toBe(544);
    expect(states).toEqual(['proving', 'completed']);
    expect(double.verifyCalls).toHaveLength(1);
    expect(double.order).toEqual(['generateArgs', 'prove', 'verify']);
    await sleep(20);
    expect(unhandled).toBe(0);
  });
});

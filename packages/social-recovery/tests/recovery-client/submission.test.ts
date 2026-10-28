import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  decodeRevert,
  encodeAttemptRequest,
  encodeCancelRequest,
  KitRefusalError,
  type Address, type AttemptRequest, type CancelRequest, type Hex,
  type PreparedCall,
  type ProofPlace,
} from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  attemptIn,
  callsTo,
  CLIENT_CONFIGURATION,
  errorCodes,
  HEADER,
  INJECTED,
  KEY_NEW,
  lastArg,
  MANAGER,
  pinnedOf,
  rejectionOf,
  rig,
  stateFor,
  world,
  ZERO,
} from './doubles';
import { cancelByProofsData, payloadOf, startAttemptData } from './encodings';
import { attemptVector, boundAttempt, boundCancel, cancelVector, membersOf, VALIDATION_READS } from './prepare-fixtures';

const NOW = HEADER.timestamp;
const SPONSOR = getAddress(`0x${'5b'.repeat(20)}`);
const VECTOR_ACCOUNT = getAddress('0x1111111111111111111111111111111111111111');
const VECTOR_ACTION = getAddress('0x2222222222222222222222222222222222222222');

type Submit = {
  readonly name: string;
  readonly member: 'prepareStartAttempt' | 'prepareCancelByProofs';
  readonly request: () => AttemptRequest | CancelRequest;
  readonly data: (request: never) => Hex;
  readonly encode: (request: never) => Hex;
};

const SUBMITS: readonly Submit[] = [
  {
    name: 'prepareStartAttempt',
    member: 'prepareStartAttempt',
    request: boundAttempt,
    data: startAttemptData as (request: never) => Hex,
    encode: encodeAttemptRequest as (request: never) => Hex,
  },
  {
    name: 'prepareCancelByProofs',
    member: 'prepareCancelByProofs',
    request: boundCancel,
    data: cancelByProofsData as (request: never) => Hex,
    encode: encodeCancelRequest as (request: never) => Hex,
  },
];

const submit = (built: ReturnType<typeof rig>, s: Submit, request: unknown, now: unknown = NOW, options?: unknown): Promise<PreparedCall> =>
  (built.client[s.member] as (r: unknown, n: unknown, o?: unknown) => Promise<PreparedCall>)(request, now, options);

describe('the pinned encodings stand on the blessed rows', () => {
  it('startAttempt over the attempt-request row is the row calldata', () => {
    const { request, calldata } = attemptVector();

    expect(startAttemptData(request)).toBe(calldata);
  });

  it('cancelByProofs over the cancel-request row is the row calldata', () => {
    const { request, calldata } = cancelVector();

    expect(cancelByProofsData(request)).toBe(calldata);
  });
});

describe('the blessed cancel row through prepareCancelByProofs', () => {
  it('prepares the row calldata byte for byte for a client bound to the row pair', async () => {
    const { request, calldata } = cancelVector();
    const built = rig(world(), CLIENT_CONFIGURATION, { account: VECTOR_ACCOUNT, action: VECTOR_ACTION });
    const prepared = await built.client.prepareCancelByProofs(request, NOW);

    expect(prepared.data.toLowerCase()).toBe(calldata.toLowerCase());
    expect(prepared.target.toLowerCase()).toBe(MANAGER.toLowerCase());
    expect(prepared.sender).toBe('anyone');
  });
});

describe.each(SUBMITS)('$name', (s) => {
  it('targets the manager, sent by anyone, value zero, the pinned block, the pinned bytes', async () => {
    const built = rig();
    const request = s.request();
    const prepared = await submit(built, s, request);

    expect(prepared.kind).toBe('call');
    expect(prepared.target.toLowerCase()).toBe(MANAGER.toLowerCase());
    expect(prepared.sender).toBe('anyone');
    expect(prepared.value).toBe(0n);
    expect(prepared.data.toLowerCase()).toBe(s.data(request as never).toLowerCase());
    expect(prepared.block).toEqual(pinnedOf(HEADER));
    expect(prepared.describes).toBeUndefined();
  });

  it('pins one block with the read tag and passes it to the part', async () => {
    const built = rig();

    await submit(built, s, s.request());

    expect(callsTo(built.seen, 'provider', 'block').map((one) => one.args)).toEqual([[CLIENT_CONFIGURATION.blockTags.read]]);

    const part = callsTo(built.seen, 'manager', s.member);

    expect(part).toHaveLength(1);
    expect(lastArg(part[0]!)).toEqual(pinnedOf(HEADER));
  });

  it('runs no request validation and makes no validation read', async () => {
    const built = rig();

    await submit(built, s, s.request(), NOW, { simulate: true });

    const made = membersOf(built.seen);

    expect(made.filter((member) => VALIDATION_READS.includes(member))).toEqual([]);
    expect(made).toEqual(['provider.block', `manager.${s.member}`, 'provider.call']);
  });

  it('prepares a request validation would refuse: expired, against an attempt-active state, rule unmet', async () => {
    const live = world({ state: stateFor(undefined, attemptIn('Waiting', 9n)) });
    const request = { ...s.request(), validUntil: 1, proofs: [] };
    const prepared = await submit(rig(live), s, request, HEADER.timestamp + 10_000_000);

    expect(prepared.data.toLowerCase()).toBe(s.data(request as never).toLowerCase());
  });

  it('refuses a request bound to another account with a TypeError before any provider call', async () => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, { ...s.request(), account: KEY_NEW }));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });

  it('refuses a request bound to another action with a TypeError before any provider call', async () => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, { ...s.request(), action: KEY_NEW }));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });

  it('accepts the bound pair in another spelling', async () => {
    const request = { ...s.request(), account: ACCOUNT.toLowerCase() as Address, action: ACTION.toLowerCase() as Address };

    await expect(submit(rig(), s, request)).resolves.toBeDefined();
  });

  it.each([
    ['no request', () => undefined],
    ['a string request', () => 'request'],
    ['a number attempt id', (r: Record<string, unknown>) => ({ ...r, attemptId: 9 })],
    ['a negative attempt id', (r: Record<string, unknown>) => ({ ...r, attemptId: -1n })],
    ['an attempt id over uint64', (r: Record<string, unknown>) => ({ ...r, attemptId: 2n ** 64n })],
    ['a malformed account', (r: Record<string, unknown>) => ({ ...r, account: '0x12' })],
    ['a non-hex setup body', (r: Record<string, unknown>) => ({ ...r, setupBody: '0xzz' })],
    ['a fractional validUntil', (r: Record<string, unknown>) => ({ ...r, validUntil: 1.5 })],
    ['proofs that are not an array', (r: Record<string, unknown>) => ({ ...r, proofs: 'none' })],
  ] as const)('refuses %s with a TypeError or RangeError before any provider call', async (_name, change) => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, change(s.request() as unknown as Record<string, unknown>)));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it.each([
    ['a string', '1760000000'],
    ['a negative number', -1],
    ['a fraction', 1.5],
    ['NaN', Number.NaN],
  ] as const)('refuses a now that is %s before any provider call', async (_name, now) => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, s.request(), now));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it.each([
    ['options that are a string', 'simulate'],
    ['a non-boolean simulate', { simulate: 'yes' }],
    ['a malformed from', { from: '0x1234' }],
  ] as const)('refuses %s before any provider call', async (_name, options) => {
    const built = rig();
    const thrown = await rejectionOf(submit(built, s, s.request(), NOW, options));

    expect(thrown instanceof TypeError || thrown instanceof RangeError).toBe(true);
    expect(built.seen).toEqual([]);
  });

  it('skips the simulation by the configuration default: no simulation member and no eth_call', async () => {
    const built = rig();
    const prepared = await submit(built, s, s.request());

    expect(prepared.simulation).toBeUndefined();
    expect('simulation' in prepared).toBe(false);
    expect(callsTo(built.seen, 'provider', 'call')).toEqual([]);
  });

  it('skips the simulation when the option says so over a simulating configuration', async () => {
    const built = rig(world(), { ...CLIENT_CONFIGURATION, simulate: true });
    const prepared = await submit(built, s, s.request(), NOW, { simulate: false });

    expect(prepared.simulation).toBeUndefined();
    expect(callsTo(built.seen, 'provider', 'call')).toEqual([]);
  });

  it('simulates from the zero address where no from is given, at the pinned block', async () => {
    const built = rig(world(), { ...CLIENT_CONFIGURATION, simulate: true });
    const request = s.request();
    const prepared = await submit(built, s, request);

    expect(prepared.simulation).toEqual({ success: true });

    const [call] = callsTo(built.seen, 'provider', 'call');

    expect(String(call?.args[0]).toLowerCase()).toBe(MANAGER.toLowerCase());
    expect(String(call?.args[1]).toLowerCase()).toBe(s.data(request as never).toLowerCase());
    expect(String(call?.args[2]).toLowerCase()).toBe(ZERO);
    expect(call?.args[3]).toBe(HEADER.number);
  });

  it('simulates from options.from', async () => {
    const built = rig();

    await submit(built, s, s.request(), NOW, { simulate: true, from: SPONSOR });

    expect(String(callsTo(built.seen, 'provider', 'call')[0]?.args[2]).toLowerCase()).toBe(SPONSOR.toLowerCase());
  });

  it('returns a revert as a typed failure from the simulating address', async () => {
    const data: Hex = '0xdeadbeef';
    const built = rig(world(), CLIENT_CONFIGURATION, { call: async () => Promise.reject({ data }) });
    const prepared = await submit(built, s, s.request(), NOW, { simulate: true, from: SPONSOR });

    expect(prepared.simulation).toEqual({ success: false, from: expect.any(String), error: decodeRevert(data) });
    expect((prepared.simulation as { from: string }).from.toLowerCase()).toBe(SPONSOR.toLowerCase());
  });

  it('rejects with the transport failure itself', async () => {
    const built = rig(world({ failures: new Map([['provider.call', INJECTED]]) }));

    await expect(submit(built, s, s.request(), NOW, { simulate: true })).rejects.toBe(INJECTED);
  });

  it('rejects with a block read failure itself and calls no part', async () => {
    const built = rig(world({ failures: new Map([['provider.block', INJECTED]]) }));

    await expect(submit(built, s, s.request())).rejects.toBe(INJECTED);
    expect(callsTo(built.seen, 'manager', s.member)).toEqual([]);
  });
});

/** The request with its proofs replaced. */
const withProofs = (request: AttemptRequest | CancelRequest, proofs: readonly ProofPlace[]): AttemptRequest | CancelRequest => ({ ...request, proofs });

/** The request's proofs with a second proof at a place no other proof holds, so the list has at least two. */
const twoOrMore = (request: AttemptRequest | CancelRequest): readonly ProofPlace[] => {
  const [first] = request.proofs;

  if (first === undefined) throw new Error('the fixture carries no proof');

  if (request.proofs.length > 1) return request.proofs;

  return [first, { ...first, place: first.place + 1 }];
};

/** The request's first proof copied to its place plus each offset, in the order given. */
const atOffsets = (request: AttemptRequest | CancelRequest, offsets: readonly number[]): readonly ProofPlace[] => {
  const [first] = request.proofs;

  if (first === undefined) throw new Error('the fixture carries no proof');

  return offsets.map((offset) => ({ ...first, place: first.place + offset }));
};

/** The encoder's own refusal of a request. */
const encoderRefusal = (s: Submit, request: AttemptRequest | CancelRequest): unknown => {
  try {
    s.encode(request as never);
  } catch (error: unknown) {
    return error;
  }

  return undefined;
};

describe.each(SUBMITS)('$name: a repeated proof place before the pin', (s) => {
  const DUPLICATES: readonly (readonly [string, (request: AttemptRequest | CancelRequest) => readonly ProofPlace[]])[] = [
    ['one proof given twice', (request) => [...twoOrMore(request), twoOrMore(request)[0] as ProofPlace]],
    [
      'two proofs sharing one place',
      (request) => {
        const [first, second] = twoOrMore(request) as [ProofPlace, ProofPlace];

        return [first, { ...second, place: first.place }];
      },
    ],
    ['a repeat out of order', (request) => [...twoOrMore(request)].reverse().concat(twoOrMore(request).slice(-1))],
    ['the middle place repeated among four proofs', (request) => atOffsets(request, [0, 1, 1, 2])],
    ['a repeat around the middle of three proofs', (request) => atOffsets(request, [1, 0, 1])],
    ['two places each repeated, out of order', (request) => atOffsets(request, [2, 0, 2, 0])],
  ];

  it.each(DUPLICATES)('refuses %s with the encoder\'s RangeError and zero provider calls, simulating or not', async (_name, proofsOf) => {
    for (const options of [undefined, { simulate: true }, { simulate: false }]) {
      const built = rig(world(), { ...CLIENT_CONFIGURATION, simulate: true });
      const request = withProofs(s.request(), proofsOf(s.request()));
      const expected = encoderRefusal(s, request);
      const thrown = await rejectionOf(submit(built, s, request, NOW, options));

      expect(expected).toBeInstanceOf(RangeError);
      expect(thrown).toBeInstanceOf(RangeError);
      expect((thrown as RangeError).message).toBe((expected as RangeError).message);
      expect(built.seen).toEqual([]);
    }
  });

  it('prepares three unique proofs given in reverse, the bytes those of the sorted request', async () => {
    const built = rig();
    const prepared = await submit(built, s, withProofs(s.request(), atOffsets(s.request(), [2, 1, 0])));

    expect(prepared.data.toLowerCase()).toBe(s.data(withProofs(s.request(), atOffsets(s.request(), [0, 1, 2])) as never).toLowerCase());
  });

  it('prepares unique proofs given out of order, the bytes those of the sorted request', async () => {
    const sorted = twoOrMore(s.request());
    const request = withProofs(s.request(), [...sorted].reverse());
    const built = rig();
    const prepared = await submit(built, s, request);

    expect(prepared.data.toLowerCase()).toBe(s.data(withProofs(s.request(), sorted) as never).toLowerCase());
  });
});

describe.each(SUBMITS)('$name: a proof array with a hole before the pin', (s) => {
  const HOLES: readonly (readonly [string, (request: AttemptRequest | CancelRequest) => readonly ProofPlace[], number])[] = [
    ['an entirely sparse array', () => new Array<ProofPlace>(1), 0],
    [
      'a middle hole',
      (request) => {
        const [first, , third] = atOffsets(request, [0, 1, 2]);

        // eslint-disable-next-line no-sparse-arrays
        return [first, , third] as ProofPlace[];
      },
      1,
    ],
    [
      'a trailing hole',
      (request) => {
        const proofs = [...atOffsets(request, [0, 1])];

        proofs.length = 3;

        return proofs;
      },
      2,
    ],
  ];

  it.each(HOLES)('refuses %s with a TypeError naming the first hole and zero calls, simulating or not', async (_name, proofsOf, index) => {
    for (const options of [undefined, { simulate: true }, { simulate: false }]) {
      const built = rig(world(), { ...CLIENT_CONFIGURATION, simulate: true });
      const thrown = await rejectionOf(submit(built, s, withProofs(s.request(), proofsOf(s.request())), NOW, options));

      expect(thrown).toBeInstanceOf(TypeError);
      expect((thrown as TypeError).message).toContain(`request.proofs[${index}]`);
      expect(built.seen).toEqual([]);
    }
  });

  it.each(HOLES)('refuses %s without reaching a block read that would reject', async (_name, proofsOf) => {
    const built = rig(world({ failures: new Map([['provider.block', INJECTED]]) }));
    const thrown = await rejectionOf(submit(built, s, withProofs(s.request(), proofsOf(s.request()))));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(thrown).not.toBe(INJECTED);
    expect(built.seen).toEqual([]);
  });
});

describe('prepareStartAttempt: the opening payload', () => {
  it.each([
    ['three bytes', '0xabcdef'],
    ['the empty payload', '0x'],
    ['a pair with a trailing byte', `${payloadOf(KEY_NEW, ACCOUNT)}00`],
  ] as const)('refuses a payload the codec cannot decode (%s) with one handover.malformed finding', async (_name, payload) => {
    const built = rig();
    const thrown = await rejectionOf(built.client.prepareStartAttempt({ ...boundAttempt(), payload: payload as Hex }, NOW));

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect(errorCodes(thrown)).toEqual(['handover.malformed']);
    expect(Object.hasOwn(thrown as object, 'cause')).toBe(false);
    expect(callsTo(built.seen, 'manager', 'prepareStartAttempt')).toEqual([]);
    expect(callsTo(built.seen, 'provider', 'call')).toEqual([]);
  });
});

describe('a request of the other kind', () => {
  it('prepareStartAttempt refuses a cancel request with a TypeError before any provider call', async () => {
    const built = rig();
    const thrown = await rejectionOf(built.client.prepareStartAttempt(boundCancel() as unknown as AttemptRequest, NOW));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });

  it('prepareCancelByProofs refuses an attempt request with a TypeError before any provider call', async () => {
    const built = rig();
    const thrown = await rejectionOf(built.client.prepareCancelByProofs(boundAttempt() as unknown as CancelRequest, NOW));

    expect(thrown).toBeInstanceOf(TypeError);
    expect(built.seen).toEqual([]);
  });
});

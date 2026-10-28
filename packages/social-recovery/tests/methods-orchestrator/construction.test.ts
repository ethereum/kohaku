import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  FORMATS_MISSING_MESSAGE,
  MethodsOrchestrator,
  type ActionCodecRegistry,
  type Address,
  type DeviceBinding,
  type IActionCodec,
  type IRecoveryMethod,
  type MethodRegistry,
} from '../../src/index';
import { strictCodec } from '../description/request-fixtures';
import {
  ALL_BINDINGS,
  approval,
  BROKEN_CHECKSUM,
  isArgumentError,
  LETTERED_METHOD,
  OTHER_METHOD,
  recordingMethod,
  REQUEST_METHOD,
  thrownBy,
  ZERO,
  type MethodCall,
} from './doubles';

const ACTION = approval().action;

/** A two-slot array whose first slot is a hole. */
const holed = <T>(second: T): T[] => {
  const array: T[] = [];

  array[1] = second;

  return array;
};

const build = (methods: unknown, codecs: unknown = new Map(), bindings: unknown = ALL_BINDINGS): MethodsOrchestrator =>
  new MethodsOrchestrator(methods as MethodRegistry, codecs as ActionCodecRegistry, bindings as readonly DeviceBinding[]);

const withMembers = (method: IRecoveryMethod, change: Record<string, unknown>): IRecoveryMethod => ({ ...method, ...change }) as IRecoveryMethod;

describe('construction takes the two registries and the runtime\'s bindings, and no provider', () => {
  it('empty registries build an orchestrator that serves nothing', () => {
    expect(build(new Map(), new Map(), [])).toBeInstanceOf(MethodsOrchestrator);
  });

  it('a registry of each shipped shape builds', () => {
    const { method } = recordingMethod();

    expect(build(new Map([[REQUEST_METHOD, method]]), new Map([[ACTION, strictCodec([ACTION])]]))).toBeInstanceOf(MethodsOrchestrator);
  });
});

describe('the method registry is checked whole at construction', () => {
  const calls: MethodCall[] = [];
  const recorded = () => {
    const double = recordingMethod();

    calls.length = 0;

    return {
      method: new Proxy(double.method, {
        get(target, key, receiver) {
          const value: unknown = Reflect.get(target, key, receiver);

          return typeof value === 'function'
            ? (...args: unknown[]) => {
                calls.push({ member: String(key), args });

                return (value as (...inner: unknown[]) => unknown)(...args);
              }
            : value;
        },
      }),
    };
  };

  const refusals: readonly [string, () => unknown, 'type' | 'range' | 'either'][] = [
    ['not a map', () => build({ get: () => undefined }), 'type'],
    ['null', () => build(null), 'type'],
    ['a plain object of entries', () => build({ [REQUEST_METHOD]: recordingMethod().method }), 'type'],
    ['a key that is not an address', () => build(new Map([['wallet', recordingMethod().method]])), 'type'],
    ['a key whose checksum fails', () => build(new Map([[BROKEN_CHECKSUM, recordingMethod().method]])), 'type'],
    [
      'two spellings of one address',
      () =>
        build(
          new Map([
            [LETTERED_METHOD, recordingMethod().method],
            [LETTERED_METHOD.toLowerCase(), recordingMethod().method],
          ]),
        ),
      'type',
    ],
    ['the zero address as a key', () => build(new Map([[ZERO, recordingMethod().method]])), 'either'],
    ['a value that is not an object', () => build(new Map([[REQUEST_METHOD, 'wallet']])), 'type'],
    ['a value missing signingInput', () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { signingInput: undefined })]])), 'type'],
    ['a value missing verify', () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { verify: 'yes' })]])), 'type'],
    ['a value missing replyFrom', () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { replyFrom: undefined })]])), 'type'],
    ['a value missing enrollInput', () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { enrollInput: undefined })]])), 'type'],
    ['a value missing configFrom', () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { configFrom: undefined })]])), 'type'],
    ['a value missing describe', () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { describe: undefined })]])), 'type'],
    ['a value missing modules', () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { modules: undefined })]])), 'type'],
    ['a value with no codec', () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { codec: undefined })]])), 'type'],
    [
      'a value with an unknown binding',
      () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { deviceBinding: 'usb-stick' })]])),
      'either',
    ],
    ['a value with no binding', () => build(new Map([[REQUEST_METHOD, withMembers(recordingMethod().method, { deviceBinding: undefined })]])), 'either'],
  ];

  for (const [name, attempt, fault] of refusals) {
    it(`${name} is refused`, () => {
      const error = thrownBy(attempt);

      if (fault === 'type') expect(error).toBeInstanceOf(TypeError);
      else if (fault === 'range') expect(error).toBeInstanceOf(RangeError);
      else expect(isArgumentError(error)).toBe(true);
    });
  }

  it('a refused registry calls none of its implementations', () => {
    const { method } = recorded();

    thrownBy(() => build(new Map<Address, IRecoveryMethod>([[REQUEST_METHOD, method], [ZERO, method]])));

    expect(calls).toHaveLength(0);
  });

  it('a registry the caller changes afterwards changes nothing the orchestrator serves', () => {
    const { method, calls: seen } = recordingMethod();
    const methods = new Map<Address, IRecoveryMethod>([[REQUEST_METHOD, method]]);
    const orchestrator = build(methods);

    methods.delete(REQUEST_METHOD);
    methods.set(OTHER_METHOD, recordingMethod().method);
    orchestrator.signingInput(approval());

    expect(seen).toHaveLength(1);
    expect(thrownBy(() => orchestrator.enrollInput(OTHER_METHOD, {}))).toBeDefined();
  });

  it('one implementation may serve several addresses', () => {
    const { method } = recordingMethod();

    expect(build(new Map([[REQUEST_METHOD, method], [OTHER_METHOD, method]]))).toBeInstanceOf(MethodsOrchestrator);
  });
});

describe('the codec registry is checked whole at construction', () => {
  const codec = strictCodec([ACTION]);
  const refusals: readonly [string, () => unknown, 'type' | 'range' | 'either'][] = [
    ['not a map', () => build(new Map(), [[ACTION, codec]]), 'type'],
    ['a key that is not an address', () => build(new Map(), new Map([['action', codec]])), 'type'],
    ['a key whose checksum fails', () => build(new Map(), new Map([[BROKEN_CHECKSUM, strictCodec([BROKEN_CHECKSUM])]])), 'type'],
    [
      'two spellings of one action',
      () =>
        build(
          new Map(),
          new Map([
            [LETTERED_METHOD, strictCodec([LETTERED_METHOD])],
            [LETTERED_METHOD.toLowerCase(), strictCodec([LETTERED_METHOD])],
          ]),
        ),
      'type',
    ],
    ['the zero address as a key', () => build(new Map(), new Map([[ZERO, strictCodec([ZERO])]])), 'either'],
    ['a codec registered under an action it does not list', () => build(new Map(), new Map([[OTHER_METHOD, codec]])), 'range'],
    ['a codec with no actions', () => build(new Map(), new Map([[ACTION, { ...codec, actions: undefined }]])), 'type'],
    ['a codec whose actions has a hole', () => build(new Map(), new Map([[ACTION, { ...codec, actions: holed(ACTION) }]])), 'type'],
    ['a codec whose actions holds junk', () => build(new Map(), new Map([[ACTION, { ...codec, actions: [ACTION, 'x'] }]])), 'type'],
    ['a codec with no decode', () => build(new Map(), new Map([[ACTION, { ...codec, decode: undefined }]])), 'type'],
    ['a codec with no encode', () => build(new Map(), new Map([[ACTION, { ...codec, encode: 1 }]])), 'type'],
    ['a codec that is not an object', () => build(new Map(), new Map([[ACTION, 'codec']])), 'type'],
  ];

  for (const [name, attempt, fault] of refusals) {
    it(`${name} is refused`, () => {
      const error = thrownBy(attempt);

      if (fault === 'type') expect(error).toBeInstanceOf(TypeError);
      else if (fault === 'range') expect(error).toBeInstanceOf(RangeError);
      else expect(isArgumentError(error)).toBe(true);
    });
  }

  it('a codec listing its action in another spelling than the key is accepted', () => {
    const lettered = strictCodec([LETTERED_METHOD.toLowerCase() as Address]);

    expect(build(new Map(), new Map([[getAddress(LETTERED_METHOD), lettered]]))).toBeInstanceOf(MethodsOrchestrator);
  });

  it('a codec registry the caller changes afterwards changes nothing the description decodes with', () => {
    const codecs = new Map<Address, IActionCodec>([[ACTION, codec]]);
    const { method } = recordingMethod();
    const orchestrator = build(new Map([[REQUEST_METHOD, method]]), codecs);
    const before = orchestrator.describeRequest(approval());

    codecs.delete(ACTION);

    expect(orchestrator.describeRequest(approval())).toStrictEqual(before);
  });
});

describe('the runtime\'s bindings are checked at construction', () => {
  const refusals: readonly [string, unknown][] = [
    ['not an array', 'none'],
    ['a hole', holed('none')],
    ['an unknown binding', ['none', 'usb-stick']],
    ['a binding named twice', ['none', 'none']],
    ['null', null],
  ];

  for (const [name, bindings] of refusals) {
    it(`${name} is refused`, () => {
      expect(isArgumentError(thrownBy(() => build(new Map(), new Map(), bindings)))).toBe(true);
    });
  }

  it('a missing bindings list is a TypeError naming the argument', () => {
    const { method } = recordingMethod();
    const error = thrownBy(
      () => new MethodsOrchestrator(new Map([[REQUEST_METHOD, method]]), new Map(), undefined as unknown as readonly DeviceBinding[]),
    );

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toContain('bindings');
  });

  it('a bindings list the caller changes afterwards changes nothing', () => {
    const bindings: DeviceBinding[] = ['none'];
    const { method, calls } = recordingMethod('external-app');
    const orchestrator = build(new Map([[REQUEST_METHOD, method]]), new Map(), bindings);

    bindings.push('external-app');

    expect(thrownBy(() => orchestrator.signingInput(approval()))).toBeDefined();
    expect(calls).toHaveLength(0);
  });
});

/** A map-like registry with a `get` that answers nothing and an iterator over the given raw entries. */
const mapLike = (entries: readonly unknown[]) => ({
  get: () => undefined,
  *[Symbol.iterator]() {
    yield* entries;
  },
});

/** A two-slot entry with only the given slot filled, the other a hole. */
const holedEntry = (slot: 0 | 1, value: unknown): unknown[] => {
  const entry: unknown[] = [];

  entry[slot] = value;
  entry.length = 2;

  return entry;
};

/** A one-slot entry whose index 1 comes from its prototype rather than from itself. */
const inheritedEntry = (key: unknown, value: unknown): unknown[] => {
  const proto: unknown[] = Object.create(Array.prototype) as unknown[];

  proto[1] = value;

  const entry: unknown[] = [key];

  Object.setPrototypeOf(entry, proto);

  return entry;
};

describe('each registry entry must hold its key and value as its own two slots', () => {
  const registries: readonly [string, Address, unknown][] = [
    ['methods', REQUEST_METHOD, recordingMethod().method],
    ['codecs', ACTION, strictCodec([ACTION])],
  ];

  for (const [name, key, value] of registries) {
    const buildWith = (registry: unknown): MethodsOrchestrator => (name === 'methods' ? build(registry) : build(new Map(), registry));

    it(`${name}: a hole at slot 0 is a TypeError naming the entry and index 0`, () => {
      const error = thrownBy(() => buildWith(mapLike([holedEntry(1, value)])));

      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain(`${name} entry 0[0] ${FORMATS_MISSING_MESSAGE}`);
    });

    it(`${name}: a hole at slot 1 is a TypeError naming the entry and index 1`, () => {
      const error = thrownBy(() => buildWith(mapLike([holedEntry(0, key)])));

      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain(`${name} entry 0[1] ${FORMATS_MISSING_MESSAGE}`);
    });

    it(`${name}: a value inherited at index 1 through the prototype is refused`, () => {
      const entry = inheritedEntry(key, value);

      expect(entry[1]).toBe(value);

      const error = thrownBy(() => buildWith(mapLike([entry])));

      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toContain(`${name} entry 0[1] ${FORMATS_MISSING_MESSAGE}`);
    });

    it(`${name}: the hole is named at its entry's position`, () => {
      const error = thrownBy(() => buildWith(mapLike([[key, value], holedEntry(0, OTHER_METHOD)])));

      expect((error as Error).message).toContain(`${name} entry 1[1] ${FORMATS_MISSING_MESSAGE}`);
    });

    it(`${name}: a native Map with valid entries is accepted as before`, () => {
      expect(buildWith(new Map([[key, value]]))).toBeInstanceOf(MethodsOrchestrator);
    });
  }
});

describe('the dense-array checks on a codec\'s actions and the bindings list', () => {
  const codec = strictCodec([ACTION]);

  /** A two-slot array whose first slot is its own and whose second comes from its prototype. */
  const inheritedSecond = <T>(first: T, second: T): T[] => {
    const proto: T[] = Object.create(Array.prototype) as T[];

    proto[1] = second;

    const array: T[] = [first];

    Object.setPrototypeOf(array, proto);
    array.length = 2;

    return array;
  };

  it('an action inherited through the prototype is refused, naming its position', () => {
    const actions = inheritedSecond<Address>(ACTION, OTHER_METHOD);

    expect(actions[1]).toBe(OTHER_METHOD);

    const error = thrownBy(() => build(new Map(), new Map([[ACTION, { ...codec, actions }]])));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/actions\[1\]/);
  });

  it('a hole at the first action is refused, naming its position', () => {
    const actions: Address[] = [];

    actions[1] = ACTION;

    const error = thrownBy(() => build(new Map(), new Map([[ACTION, { ...codec, actions }]])));

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toMatch(/actions\[0\]/);
  });

  it('a binding inherited through the prototype is refused', () => {
    const bindings = inheritedSecond<DeviceBinding>('none', 'external-app');

    expect(isArgumentError(thrownBy(() => build(new Map(), new Map(), bindings)))).toBe(true);
  });

  it('an array as a method value or a codec value is refused', () => {
    expect(thrownBy(() => build(new Map([[REQUEST_METHOD, []]])))).toBeInstanceOf(TypeError);
    expect(thrownBy(() => build(new Map(), new Map([[ACTION, [ACTION]]])))).toBeInstanceOf(TypeError);
  });

  it('a null method value or codec value is refused', () => {
    expect(thrownBy(() => build(new Map([[REQUEST_METHOD, null]])))).toBeInstanceOf(TypeError);
    expect(thrownBy(() => build(new Map(), new Map([[ACTION, null]])))).toBeInstanceOf(TypeError);
  });
});

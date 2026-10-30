import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  CLIENT_CORE_SIMULATION_FROM,
  decodeRevert,
  simulateCall,
  simulatePrepared,
  simulationFrom,
  type Hex,
  type PreparedBatch,
  type PreparedCall,
  type PrepareOptions,
} from '../../src/index';
import { deepFreeze, NO_SETUP_REVERT, preparedBatch, preparedCall, UNKNOWN_REVERT } from './simulation-fixtures';
import { ACCOUNT, ACCOUNT_BAD_CHECKSUM, ACCOUNT_MIXED, BLOCK, providerDouble, SENDER, ZERO_ADDRESS } from './support';

const ON = { simulate: true } as const;
const OFF = { simulate: false } as const;

describe('simulationFrom', () => {
  it('runs an account-sent call from the account, ignoring options.from', () => {
    expect(simulationFrom(preparedCall('account'), ACCOUNT)).toBe(ACCOUNT);
    expect(simulationFrom(preparedCall('account'), ACCOUNT, { from: SENDER })).toBe(ACCOUNT);
  });

  it('ignores a malformed options.from on an account-sent call', () => {
    expect(simulationFrom(preparedCall('account'), ACCOUNT, { from: '0x12' })).toBe(ACCOUNT);
    expect(simulationFrom(preparedCall('account'), ACCOUNT, { from: ACCOUNT_BAD_CHECKSUM })).toBe(ACCOUNT);
  });

  it('runs a permissionless call from options.from, else from the zero address', () => {
    expect(simulationFrom(preparedCall('anyone'), ACCOUNT, { from: SENDER })).toBe(SENDER);
    expect(simulationFrom(preparedCall('anyone'), ACCOUNT)).toBe(CLIENT_CORE_SIMULATION_FROM);
    expect(simulationFrom(preparedCall('anyone'), ACCOUNT, {})).toBe(ZERO_ADDRESS);
    expect(simulationFrom(preparedCall('anyone'), ACCOUNT, { simulate: true })).toBe(ZERO_ADDRESS);
  });

  it.each([
    ['too short', '0x12'],
    ['a failing checksum', ACCOUNT_BAD_CHECKSUM],
    ['not a string', 5],
  ])('refuses a permissionless options.from that is %s with a TypeError', (_, from) => {
    expect(() => simulationFrom(preparedCall('anyone'), ACCOUNT, { from } as unknown as PrepareOptions)).toThrow(TypeError);
  });

  it('accepts every spelling of options.from and returns the same address', () => {
    const lower = ACCOUNT_MIXED.toLowerCase() as Hex;

    for (const spelling of [lower, `0x${lower.slice(2).toUpperCase()}` as Hex, ACCOUNT_MIXED]) {
      expect(simulationFrom(preparedCall('anyone'), ACCOUNT, { from: spelling }).toLowerCase()).toBe(lower);
    }
  });
});

describe('simulateCall', () => {
  it('makes one call to the target with the data, the from and the block number, and reports success', async () => {
    const double = providerDouble(async () => '0xffff');
    const call = preparedCall('anyone');

    await expect(simulateCall(double.provider, call, SENDER, BLOCK)).resolves.toStrictEqual({ success: true });
    expect(double.calls).toEqual([{ to: call.target, data: call.data, from: SENDER, block: BLOCK.number }]);
    expect(double.blockTags).toEqual([]);
    expect(double.others).toEqual([]);
  });

  it.each([
    ['a known manager error', NO_SETUP_REVERT],
    ['an unknown selector', UNKNOWN_REVERT],
    ['empty revert data', '0x' as Hex],
  ])('turns a revert carrying %s into a typed failure decoded by decodeRevert', async (_, data) => {
    const double = providerDouble(async () => {
      throw { data };
    });
    const result = await simulateCall(double.provider, preparedCall('anyone'), SENDER, BLOCK);

    expect(result).toStrictEqual({ success: false, from: SENDER, error: decodeRevert(data) });
  });

  it('decodes the known manager error by name', async () => {
    const double = providerDouble(async () => {
      throw { data: NO_SETUP_REVERT };
    });
    const result = await simulateCall(double.provider, preparedCall('anyone'), SENDER, BLOCK);

    expect(result.success === false && result.error.known && result.error.name).toBe('PolicyManager_NoSetup');
  });

  it.each([
    ['an Error', new Error('connection reset')],
    ['an object without data', { code: -32_603 }],
    ['an object whose data is not hex', { data: 'oops' }],
    ['a string', 'boom'],
  ])('rethrows %s as the same value', async (_, failure) => {
    const double = providerDouble(async () => {
      throw failure;
    });

    await expect(simulateCall(double.provider, preparedCall('anyone'), SENDER, BLOCK)).rejects.toBe(failure);
  });
});

describe('simulatePrepared on a single call', () => {
  it.each([
    ['the option is false', { simulate: true }, OFF],
    ['no option and the configuration is false', { simulate: false }, undefined],
    ['an empty option and the configuration is false', { simulate: false }, {}],
  ] as const)('skips the simulation when %s', async (_, configuration, options) => {
    const double = providerDouble();
    const call = preparedCall('anyone');
    const result = await simulatePrepared(double.provider, call, ACCOUNT, configuration, options);

    expect(result).toEqual(call);
    expect(result.simulation).toBeUndefined();
    expect('simulation' in result).toBe(false);
    expect(double.calls).toEqual([]);
  });

  it('simulates when the option is true over a false configuration, and when the configuration is true', async () => {
    for (const [configuration, options] of [
      [{ simulate: false }, ON],
      [{ simulate: true }, undefined],
    ] as const) {
      const double = providerDouble();
      const result = await simulatePrepared(double.provider, preparedCall('anyone'), ACCOUNT, configuration, options);

      expect(result.simulation).toStrictEqual({ success: true });
      expect(double.calls).toHaveLength(1);
    }
  });

  it('runs an account-sent call from the account even when options.from is given', async () => {
    const double = providerDouble();

    await simulatePrepared(double.provider, preparedCall('account'), ACCOUNT, { simulate: true }, { from: SENDER });
    expect(double.calls[0]?.from).toBe(ACCOUNT);
  });

  it('runs a permissionless call from options.from, else the zero address', async () => {
    const withFrom = providerDouble();
    const without = providerDouble();

    await simulatePrepared(withFrom.provider, preparedCall('anyone'), ACCOUNT, { simulate: true }, { from: SENDER });
    await simulatePrepared(without.provider, preparedCall('anyone'), ACCOUNT, { simulate: true });
    expect(withFrom.calls[0]?.from).toBe(SENDER);
    expect(without.calls[0]?.from).toBe(ZERO_ADDRESS);
  });

  it('runs at the block number the record carries', async () => {
    const double = providerDouble();
    const pinned = { number: 77, hash: BLOCK.hash };

    await simulatePrepared(double.provider, preparedCall('anyone', '0x01', pinned), ACCOUNT, { simulate: true });
    expect(double.calls[0]?.block).toBe(77);
    expect(double.blockTags).toEqual([]);
  });

  it('returns a copy carrying the simulation and leaves the frozen input untouched', async () => {
    const call = deepFreeze({ ...preparedCall('anyone'), describes: [{ target: SENDER, value: 0n, data: '0x' as Hex }] });
    const double = providerDouble(async () => {
      throw { data: NO_SETUP_REVERT };
    });
    const result = await simulatePrepared(double.provider, call, ACCOUNT, { simulate: true });
    const { simulation, ...rest } = result;

    expect(rest).toEqual(call);
    expect(simulation).toStrictEqual({ success: false, from: ZERO_ADDRESS, error: decodeRevert(NO_SETUP_REVERT) });
    expect(call).not.toHaveProperty('simulation');
  });

  it('replaces a simulation the input already carried', async () => {
    const stale: PreparedCall = { ...preparedCall('anyone'), simulation: { success: true } };
    const double = providerDouble(async () => {
      throw { data: UNKNOWN_REVERT };
    });
    const result = await simulatePrepared(double.provider, stale, ACCOUNT, { simulate: true });

    expect(result.simulation?.success).toBe(false);
  });

  it('propagates a transport failure as the same value', async () => {
    const failure = new Error('rate limited');
    const double = providerDouble(async () => {
      throw failure;
    });

    await expect(simulatePrepared(double.provider, preparedCall('anyone'), ACCOUNT, { simulate: true })).rejects.toBe(failure);
  });

  it('refuses a malformed permissionless options.from with a TypeError, before any call', async () => {
    const double = providerDouble();

    await expect(simulatePrepared(double.provider, preparedCall('anyone'), ACCOUNT, { simulate: true }, { from: '0x12' })).rejects.toThrow(
      TypeError,
    );
    expect(double.calls).toEqual([]);
  });

  it('reports the from of a failure as an address equal to the one it ran from', async () => {
    const lower = ACCOUNT_MIXED.toLowerCase() as Hex;
    const double = providerDouble(async () => {
      throw { data: UNKNOWN_REVERT };
    });
    const result = await simulatePrepared(double.provider, preparedCall('anyone'), ACCOUNT, { simulate: true }, { from: lower });

    expect(result.simulation?.success === false && result.simulation.from).toBe(getAddress(lower));
  });
});

describe('simulatePrepared on a batch', () => {
  it('simulates each call in list order at the batch block, each carrying its own result', async () => {
    const double = providerDouble(async (seen) => {
      if (seen.data === '0xbbbbbbbb') throw { data: NO_SETUP_REVERT };

      return '0x';
    });
    const batch = deepFreeze(preparedBatch());
    const result = await simulatePrepared(double.provider, batch, ACCOUNT, { simulate: true });

    expect(double.calls.map((seen) => [seen.data, seen.from, seen.block])).toEqual([
      ['0xaaaaaaaa', ACCOUNT, BLOCK.number],
      ['0xbbbbbbbb', ACCOUNT, BLOCK.number],
    ]);
    expect(result.kind).toBe('batch');
    expect(result.atomic).toBe(true);
    expect(result.block).toEqual(BLOCK);
    expect(result).not.toHaveProperty('simulation');
    expect(result.calls.map((call) => call.simulation)).toStrictEqual([
      { success: true },
      { success: false, from: ACCOUNT, error: decodeRevert(NO_SETUP_REVERT) },
    ]);
    expect(result.calls.map((call) => ({ ...call, simulation: undefined }))).toEqual(batch.calls.map((call) => ({ ...call, simulation: undefined })));
  });

  it('starts the second call only after the first settled', async () => {
    const events: string[] = [];
    const double = providerDouble(async (seen) => {
      events.push(`start ${seen.data}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push(`end ${seen.data}`);

      return '0x';
    });

    await simulatePrepared(double.provider, preparedBatch(), ACCOUNT, { simulate: true });
    expect(events).toEqual(['start 0xaaaaaaaa', 'end 0xaaaaaaaa', 'start 0xbbbbbbbb', 'end 0xbbbbbbbb']);
  });

  it('keeps a non-atomic flag and an empty batch as they are', async () => {
    const double = providerDouble();
    const empty: PreparedBatch = { ...preparedBatch([]), atomic: false };
    const result = await simulatePrepared(double.provider, empty, ACCOUNT, { simulate: true });

    expect(result).toEqual(empty);
    expect(double.calls).toEqual([]);
  });

  it('skips the whole batch when the simulation is off', async () => {
    const double = providerDouble();
    const batch = preparedBatch();
    const result = await simulatePrepared(double.provider, batch, ACCOUNT, { simulate: true }, OFF);

    expect(result).toEqual(batch);
    expect(result.calls.every((call) => !('simulation' in call))).toBe(true);
    expect(double.calls).toEqual([]);
  });

  it('refuses a batch whose inner call carries another block with a TypeError, before any call', async () => {
    const double = providerDouble();
    const batch = preparedBatch([preparedCall('account'), preparedCall('account', '0x01', { number: BLOCK.number - 1, hash: BLOCK.hash })]);

    await expect(simulatePrepared(double.provider, batch, ACCOUNT, { simulate: true })).rejects.toThrow(TypeError);
    expect(double.calls).toEqual([]);
  });

  it('propagates a transport failure on the second call as the same value', async () => {
    const failure = new Error('socket closed');
    const double = providerDouble(async (_, index) => {
      if (index === 1) throw failure;

      return '0x';
    });

    await expect(simulatePrepared(double.provider, preparedBatch(), ACCOUNT, { simulate: true })).rejects.toBe(failure);
  });

  it('runs a mixed batch from the account and from options.from by sender', async () => {
    const double = providerDouble();
    const batch = preparedBatch([preparedCall('account'), preparedCall('anyone')]);

    await simulatePrepared(double.provider, batch, ACCOUNT, { simulate: true }, { from: SENDER });
    expect(double.calls.map((seen) => seen.from)).toEqual([ACCOUNT, SENDER]);
  });
});

/** Three call slots with the middle one never assigned. */
const sparseCalls = (): PreparedCall[] => {
  const calls = new Array<PreparedCall>(3);

  calls[0] = preparedCall('account');
  calls[2] = preparedCall('account');

  return calls;
};

describe('simulatePrepared on malformed records', () => {
  const malformedBatches: readonly (readonly [string, PreparedBatch])[] = [
    ['a sparse call list', { ...preparedBatch(), calls: sparseCalls() }],
    ['an inner call without a block', preparedBatch([preparedCall('account'), { ...preparedCall('account'), block: undefined } as unknown as PreparedCall])],
    ['an inner call with an unknown sender', preparedBatch([{ ...preparedCall('account'), sender: 'stranger' } as unknown as PreparedCall])],
    ['a call list that is not an array', { ...preparedBatch(), calls: {} as unknown as PreparedCall[] }],
  ];

  it.each(malformedBatches)('refuses %s with a TypeError', async (_, batch) => {
    await expect(simulatePrepared(providerDouble().provider, batch, ACCOUNT, { simulate: true })).rejects.toThrow(TypeError);
  });

  it('refuses a batch with a malformed options.from on its permissionless call', async () => {
    const batch = preparedBatch([preparedCall('account'), preparedCall('anyone')]);

    await expect(simulatePrepared(providerDouble().provider, batch, ACCOUNT, { simulate: true }, { from: '0x12' })).rejects.toThrow(TypeError);
  });

  it('ignores a malformed options.from on a batch the account sends alone', async () => {
    const result = await simulatePrepared(providerDouble().provider, preparedBatch(), ACCOUNT, { simulate: true }, { from: '0x12' });

    expect(result.calls.map((call) => call.simulation)).toStrictEqual([{ success: true }, { success: true }]);
  });

  it('refuses a malformed account with a TypeError on an account-sent call', async () => {
    await expect(simulatePrepared(providerDouble().provider, preparedCall('account'), '0x12', { simulate: true })).rejects.toThrow(TypeError);
  });

  it('refuses a record whose block is malformed with a TypeError or RangeError, before any call', async () => {
    const double = providerDouble();
    const call = { ...preparedCall('anyone'), block: { number: -1, hash: BLOCK.hash } };

    await expect(simulatePrepared(double.provider, call, ACCOUNT, { simulate: true })).rejects.toThrow(RangeError);
    expect(double.calls).toEqual([]);
  });
});

describe('simulateCall normalises the record on entry', () => {
  it.each([
    ['all lower case', ACCOUNT_MIXED.toLowerCase() as Hex],
    ['all upper case', `0x${ACCOUNT_MIXED.slice(2).toUpperCase()}` as Hex],
    ['EIP-55', ACCOUNT_MIXED],
  ])('hands the provider the checksummed target and lower-cased data, target %s', async (_, target) => {
    const double = providerDouble();
    const call: PreparedCall = { ...preparedCall('anyone', '0xABCDEF12'), target };

    await simulateCall(double.provider, call, SENDER, BLOCK);
    expect(double.calls).toEqual([{ to: getAddress(ACCOUNT_MIXED), data: '0xabcdef12', from: SENDER, block: BLOCK.number }]);
  });

  it('does the same through simulatePrepared, and leaves the record as given', async () => {
    const double = providerDouble();
    const call = deepFreeze<PreparedCall>({ ...preparedCall('account', '0xDEADBEEF'), target: ACCOUNT_MIXED.toLowerCase() as Hex });
    const result = await simulatePrepared(double.provider, call, ACCOUNT, { simulate: true });

    expect(double.calls[0]).toMatchObject({ to: getAddress(ACCOUNT_MIXED), data: '0xdeadbeef' });
    expect(result.target).toBe(call.target);
    expect(result.data).toBe(call.data);
  });

  it('refuses a mixed-case target whose checksum fails, before any call', async () => {
    const double = providerDouble();
    const call: PreparedCall = { ...preparedCall('anyone'), target: ACCOUNT_BAD_CHECKSUM };

    await expect(simulateCall(double.provider, call, SENDER, BLOCK)).rejects.toThrow(TypeError);
    expect(double.calls).toEqual([]);
  });
});

describe('simulatePrepared refuses a sparse batch before any call', () => {
  const sparseAt = (hole: number): PreparedCall[] => {
    const calls = new Array<PreparedCall>(3);

    for (let index = 0; index < 3; index += 1) if (index !== hole) calls[index] = preparedCall('account');

    return calls;
  };

  it.each([0, 1, 2])('with a hole at index %i', async (hole) => {
    const double = providerDouble();

    await expect(simulatePrepared(double.provider, preparedBatch(sparseAt(hole)), ACCOUNT, { simulate: true })).rejects.toThrow(TypeError);
    expect(double.calls).toEqual([]);
  });

  it('with a trailing hole from a stretched length', async () => {
    const double = providerDouble();
    const calls = [preparedCall('account')];

    calls.length = 2;
    await expect(simulatePrepared(double.provider, preparedBatch(calls), ACCOUNT, { simulate: true })).rejects.toThrow(TypeError);
    expect(double.calls).toEqual([]);
  });
});

describe('simulatePrepared checks every call of a batch before the first call', () => {
  const second: readonly (readonly [string, PreparedCall, PrepareOptions | undefined])[] = [
    ['missing data', { ...preparedCall('account'), data: undefined } as unknown as PreparedCall, undefined],
    ['data that is not hex', { ...preparedCall('account'), data: '0xzz' } as unknown as PreparedCall, undefined],
    ['an unknown sender', { ...preparedCall('account'), sender: 'stranger' } as unknown as PreparedCall, undefined],
    ['a target that is not an address', { ...preparedCall('account'), target: '0x12' } as unknown as PreparedCall, undefined],
    ['a target with a failing checksum', { ...preparedCall('account'), target: ACCOUNT_BAD_CHECKSUM }, undefined],
    ['a call that is not an object', null as unknown as PreparedCall, undefined],
    ['a permissionless call under a malformed options.from', preparedCall('anyone'), { from: '0x12' }],
    ['a permissionless call under a checksum-failing options.from', preparedCall('anyone'), { from: ACCOUNT_BAD_CHECKSUM }],
  ];

  it.each(second)('a well-formed first call and a second with %s throw a TypeError and reach no provider call', async (_, call, options) => {
    const double = providerDouble();
    const batch = preparedBatch([preparedCall('account'), call]);

    await expect(simulatePrepared(double.provider, batch, ACCOUNT, { simulate: true }, options)).rejects.toThrow(TypeError);
    expect(double.calls).toEqual([]);
  });

  it('a malformed third call is caught before the first two are simulated', async () => {
    const double = providerDouble();
    const batch = preparedBatch([preparedCall('account'), preparedCall('anyone'), { ...preparedCall('account'), data: 5 } as unknown as PreparedCall]);

    await expect(simulatePrepared(double.provider, batch, ACCOUNT, { simulate: true })).rejects.toThrow(TypeError);
    expect(double.calls).toEqual([]);
  });
});

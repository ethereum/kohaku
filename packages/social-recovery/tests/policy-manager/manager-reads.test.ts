import { encodeAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';
import type { Address, Hex } from '../../src/index';
import { FIRST_BLOCK, ProviderDouble, always, bySelector, type Answer } from './double';
import {
  ACCOUNT,
  ACTION,
  ACTION_STATE_PARAMS,
  ATTEMPT_REQUEST_PARAM,
  BOOL_PARAMS,
  BYTES32_PARAMS,
  CANCEL_REQUEST_PARAM,
  DOMAIN_PARAMS,
  MANAGER,
  METHOD,
  OTHER,
  STRING_PARAMS,
  TRUE_WORD,
  attemptRequestOf,
  callData,
  cancelRequestOf,
  lowerOf,
  partFor,
  sel,
  SIGNATURES,
  tupleOf,
  vectorRow,
  wordOf,
} from './fixtures';

const VECTOR_ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
const VECTOR_ACTION: Address = '0x2222222222222222222222222222222222222222';
const PAYLOAD_HASH: Hex = `0x${'9a'.repeat(32)}`;
const COMMITMENT: Hex = `0x${'3b'.repeat(32)}`;

/** A raw `ActionState` value in the contract's layout, with lower-case addresses so the checksum on the way out is exercised. */
const rawState = (state: number, ignoresPause: boolean) => ({
  setupCommitment: COMMITMENT.toUpperCase().replace('0X', '0x') as Hex,
  setupNonce: (1n << 64n) - 1n,
  nextAttemptId: 8n,
  setupCommittedAtBlock: 2 ** 48 - 1,
  attempt: {
    attemptId: 7n,
    setupNonce: 6n,
    consumableAfter: 1_800_000_000,
    state,
    ignoresPause,
    payloadHash: PAYLOAD_HASH,
    order: { token: lowerOf(OTHER), amount: 10n ** 18n, payee: lowerOf(ACCOUNT) },
    usedMethods: [lowerOf(METHOD), lowerOf(ACTION)],
  },
});

const stateWord = (state: number, ignoresPause: boolean): Hex => encodeAbiParameters(ACTION_STATE_PARAMS, [rawState(state, ignoresPause)]);

/** Asserts one block read at the read tag and exactly one call to the manager at that block's number. */
function expectOneReadOfManager(provider: ProviderDouble, data: Hex): void {
  expect(provider.blockTags).toEqual(['latest']);
  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0]).toMatchObject({ to: MANAGER, data, block: FIRST_BLOCK });
  expect(provider.codeReads).toBe(0);
}

describe('stateOf()', () => {
  it('reads stateOf(account, action) for the bound pair and decodes the pinned layout field for field', async () => {
    const provider = always({ returns: stateWord(1, true) });
    const state = await partFor(provider).stateOf();

    expectOneReadOfManager(provider, callData(SIGNATURES.stateOf, [{ type: 'address' }, { type: 'address' }], [ACCOUNT, ACTION]));
    expect(sel('stateOf')).toBe('0x4d8e9270');
    expect(state).toEqual({
      setupCommitment: COMMITMENT,
      setupNonce: (1n << 64n) - 1n,
      nextAttemptId: 8n,
      setupCommittedAtBlock: 2 ** 48 - 1,
      attempt: {
        attemptId: 7n,
        setupNonce: 6n,
        consumableAfter: 1_800_000_000,
        state: 'Waiting',
        ignoresPause: true,
        payloadHash: PAYLOAD_HASH,
        order: { token: OTHER, amount: 10n ** 18n, payee: ACCOUNT },
        usedMethods: [METHOD, ACTION],
      },
    });
  });

  it('decodes a return the provider spelled in upper-case hex, hashes lower-cased', async () => {
    const upper = `0x${stateWord(1, true).slice(2).toUpperCase()}` as Hex;
    const state = await partFor(always({ returns: upper })).stateOf();

    expect(state.setupCommitment).toBe(COMMITMENT);
    expect(state.attempt.payloadHash).toBe(PAYLOAD_HASH);
    expect(state.attempt.usedMethods).toEqual([METHOD, ACTION]);
  });

  it.each([
    [0, 'None'],
    [1, 'Waiting'],
    [2, 'Cancelled'],
    [3, 'Consumed'],
  ] as const)('maps the enum index %i to %s', async (index, name) => {
    const state = await partFor(always({ returns: stateWord(index, false) })).stateOf();

    expect(state.attempt.state).toBe(name);
    expect(state.attempt.ignoresPause).toBe(false);
  });

  it.each([4, 255])('throws a TypeError on the enum value %i the contract does not declare', async (index) => {
    await expect(partFor(always({ returns: stateWord(index, false) })).stateOf()).rejects.toThrow(TypeError);
  });

  it.each([
    ['an empty return', '0x'],
    ['a single word', TRUE_WORD],
    ['the layout with ignoresPause last', 'last'],
  ] as const)('throws a RangeError on %s, bytes that do not decode as the pinned layout', async (_case, returned) => {
    const raw = rawState(1, true);
    const lastLayout = encodeAbiParameters(
      [{ type: 'tuple', components: [...ACTION_STATE_PARAMS[0].components.slice(0, 4), {
        name: 'attempt',
        type: 'tuple',
        components: [
          { name: 'attemptId', type: 'uint64' },
          { name: 'setupNonce', type: 'uint64' },
          { name: 'consumableAfter', type: 'uint48' },
          { name: 'state', type: 'uint8' },
          { name: 'payloadHash', type: 'bytes32' },
          { name: 'order', type: 'tuple', components: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'payee', type: 'address' }] },
          { name: 'usedMethods', type: 'address[]' },
          { name: 'ignoresPause', type: 'bool' },
        ],
      }] }],
      [raw],
    );

    await expect(partFor(always({ returns: returned === 'last' ? lastLayout : returned })).stateOf()).rejects.toThrow(RangeError);
  });
});

describe('hashApproval and hashCancel', () => {
  it('sends hashApproval(AttemptRequest,uint256) with an empty proof array and returns the word lower-cased', async () => {
    const request = attemptRequestOf(vectorRow('attempt-request.json', 'sorted-proofs'));
    const { digest } = vectorRow('approval-digest.json', 'normal').expected as { digest: Hex };
    const provider = always({ returns: `0x${digest.slice(2).toUpperCase()}` });
    const answer = await partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).hashApproval(request, 3);

    expect(request.proofs.length).toBeGreaterThan(0);
    expectOneReadOfManager(provider, callData(SIGNATURES.hashApproval, [ATTEMPT_REQUEST_PARAM, { type: 'uint256' }], [tupleOf({ ...request, proofs: [] }), 3n]));
    expect(answer).toBe(digest);
  });

  it('sends hashCancel(CancelRequest,uint256) with an empty proof array and returns the word lower-cased', async () => {
    const request = cancelRequestOf(vectorRow('cancel-request.json', 'one-proof'));
    const { digest } = vectorRow('cancellation-digest.json', 'normal').expected as { digest: Hex };
    const provider = always({ returns: `0x${digest.slice(2).toUpperCase()}` });
    const answer = await partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).hashCancel(request, 0);

    expectOneReadOfManager(provider, callData(SIGNATURES.hashCancel, [CANCEL_REQUEST_PARAM, { type: 'uint256' }], [tupleOf({ ...request, proofs: [] }), 0n]));
    expect(answer).toBe(digest);
  });

  it.each(['0x', `0x${'ab'.repeat(31)}`])('throws a RangeError when the digest return is %s', async (returned) => {
    const request = attemptRequestOf(vectorRow('attempt-request.json', 'sorted-proofs'));

    await expect(partFor(always({ returns: returned as Hex }), VECTOR_ACCOUNT, VECTOR_ACTION).hashApproval(request, 0)).rejects.toThrow(RangeError);
  });

  it('decodes a digest the double answered as encoded by viem', async () => {
    const request = cancelRequestOf(vectorRow('cancel-request.json', 'one-proof'));
    const word = encodeAbiParameters(BYTES32_PARAMS, [`0x${'0f'.repeat(32)}`]);

    expect(await partFor(always({ returns: word }), VECTOR_ACCOUNT, VECTOR_ACTION).hashCancel(request, 1)).toBe(`0x${'0f'.repeat(32)}`);
  });
});

describe('eip712Domain()', () => {
  const domainReturn = (chainId: bigint): Hex =>
    encodeAbiParameters(DOMAIN_PARAMS, ['0x0F', 'Social Recovery', '1', chainId, lowerOf(MANAGER), `0x${'00'.repeat(32)}`, [5n, 6n]]);

  it('decodes all seven ERC-5267 fields from one eip712Domain() call', async () => {
    const provider = always({ returns: domainReturn(11_155_111n) });
    const domain = await partFor(provider).eip712Domain();

    expectOneReadOfManager(provider, sel('eip712Domain') as Hex);
    expect(sel('eip712Domain')).toBe('0x84b0196e');
    expect(domain).toEqual({
      fields: '0x0f',
      name: 'Social Recovery',
      version: '1',
      chainId: 11_155_111,
      verifyingContract: MANAGER,
      salt: `0x${'00'.repeat(32)}`,
      extensions: [5n, 6n],
    });
  });

  it('accepts the largest safe chain id and throws a TypeError one above it', async () => {
    const safe = BigInt(Number.MAX_SAFE_INTEGER);

    expect((await partFor(always({ returns: domainReturn(safe) })).eip712Domain()).chainId).toBe(Number.MAX_SAFE_INTEGER);
    await expect(partFor(always({ returns: domainReturn(safe + 1n) })).eip712Domain()).rejects.toThrow(TypeError);
  });

  it('throws a RangeError on a return that does not decode', async () => {
    await expect(partFor(always({ returns: TRUE_WORD })).eip712Domain()).rejects.toThrow(RangeError);
  });
});

describe('name(), version() and supportsInterface(id)', () => {
  it('decodes name() and version() as the strings the manager returns', async () => {
    const provider = bySelector({
      [sel('name')]: { returns: encodeAbiParameters(STRING_PARAMS, ['PolicyManager']) },
      [sel('version')]: { returns: encodeAbiParameters(STRING_PARAMS, ['1.0.0']) },
    });
    const part = partFor(provider);

    expect(await part.name()).toBe('PolicyManager');
    expect(await part.version()).toBe('1.0.0');
    expect(provider.selectors()).toEqual(['0x06fdde03', '0x54fd4d50']);
    expect(provider.calls.every((call) => call.to === MANAGER)).toBe(true);
  });

  it.each([
    ['0x01ffc9a7', true],
    ['0xffffffff', false],
  ] as const)('sends supportsInterface(%s) and decodes the bool', async (interfaceId, supported) => {
    const provider = always({ returns: encodeAbiParameters(BOOL_PARAMS, [supported]) });

    expect(await partFor(provider).supportsInterface(interfaceId)).toBe(supported);
    expectOneReadOfManager(provider, callData(SIGNATURES.supportsInterface, [{ type: 'bytes4' }], [interfaceId]));
  });

  it('encodes an upper-case interface id lower-cased', async () => {
    const provider = always({ returns: TRUE_WORD });

    await partFor(provider).supportsInterface('0xF057A368');

    expect(provider.calls[0]?.data).toBe(`0x01ffc9a7f057a368${'00'.repeat(28)}`);
  });

  it.each([
    ['name', '0x'],
    ['version', TRUE_WORD],
    ['supportsInterface', '0x'],
    ['supportsInterface', wordOf(2)],
  ] as const)('%s throws a RangeError on the undecodable return %s', async (member, returned) => {
    const part = partFor(always({ returns: returned }));
    const read = member === 'supportsInterface' ? part.supportsInterface('0x01ffc9a7') : part[member]();

    await expect(read).rejects.toThrow(RangeError);
  });
});

describe('the strictness of a manager read\'s return', () => {
  const stringWord = encodeAbiParameters(STRING_PARAMS, ['PolicyManager']);
  const reads = [
    ['stateOf', (part: ReturnType<typeof partFor>) => part.stateOf()],
    ['name', (part: ReturnType<typeof partFor>) => part.name()],
    ['version', (part: ReturnType<typeof partFor>) => part.version()],
    ['eip712Domain', (part: ReturnType<typeof partFor>) => part.eip712Domain()],
    ['supportsInterface', (part: ReturnType<typeof partFor>) => part.supportsInterface('0x01ffc9a7')],
    ['hashApproval', (part: ReturnType<typeof partFor>) => part.hashApproval(attemptRequestOf(vectorRow('attempt-request.json', 'sorted-proofs')), 0)],
    ['hashCancel', (part: ReturnType<typeof partFor>) => part.hashCancel(cancelRequestOf(vectorRow('cancel-request.json', 'one-proof')), 0)],
  ] as const;

  it.each(reads.flatMap(([member, read]) => [
    [member, 'odd-length hex', '0x123', read] as const,
    [member, 'text that is not hex', 'not hex', read] as const,
    [member, 'hex without 0x', '00'.repeat(32), read] as const,
  ]))('%s throws a TypeError on a return of %s', async (_member, _case, returned, read) => {
    await expect(read(partFor(always({ returns: returned as Hex }), VECTOR_ACCOUNT, VECTOR_ACTION))).rejects.toThrow(TypeError);
  });

  it('name() throws a RangeError on a valid string followed by a stray word, which is not the canonical encoding', async () => {
    await expect(partFor(always({ returns: `${stringWord}${'00'.repeat(32)}` })).name()).rejects.toThrow(RangeError);
  });
});

describe('a manager read that is not answered rethrows what the provider rejected with', () => {
  const revert = { reverts: '0x08c379a0' } as const;
  const transport = new Error('node unreachable');
  const reads = [
    ['stateOf', (part: ReturnType<typeof partFor>) => part.stateOf()],
    ['name', (part: ReturnType<typeof partFor>) => part.name()],
    ['version', (part: ReturnType<typeof partFor>) => part.version()],
    ['eip712Domain', (part: ReturnType<typeof partFor>) => part.eip712Domain()],
    ['supportsInterface', (part: ReturnType<typeof partFor>) => part.supportsInterface('0x01ffc9a7')],
    ['hashApproval', (part: ReturnType<typeof partFor>) => part.hashApproval(attemptRequestOf(vectorRow('attempt-request.json', 'sorted-proofs')), 0)],
    ['hashCancel', (part: ReturnType<typeof partFor>) => part.hashCancel(cancelRequestOf(vectorRow('cancel-request.json', 'one-proof')), 0)],
  ] as const;

  it.each(reads)('%s rethrows the ProviderRevert itself, its data unchanged', async (_member, read) => {
    const rejection = { data: revert.reverts };
    const provider = new ProviderDouble(() => ({ rejects: rejection }));

    await expect(read(partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION))).rejects.toBe(rejection);
    expect(rejection).toEqual({ data: '0x08c379a0' });
    expect(provider.calls).toHaveLength(1);
  });

  it.each(reads)('%s rethrows a transport failure as thrown', async (_member, read) => {
    const answer: Answer = { rejects: transport };

    await expect(read(partFor(always(answer), VECTOR_ACCOUNT, VECTOR_ACTION))).rejects.toBe(transport);
  });
});

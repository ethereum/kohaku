import { describe, expect, it } from 'vitest';
import type { Address, Hex, PreparedCall } from '../../src/index';
import { FIRST_BLOCK, ProviderDouble, headerAt } from './double';
import {
  ACCOUNT,
  ACTION,
  ATTEMPT_REQUEST_PARAM,
  CANCEL_REQUEST_PARAM,
  MANAGER,
  METHOD,
  attemptRequestOf,
  callData,
  cancelRequestOf,
  partFor,
  sel,
  SIGNATURES,
  tupleOf,
  vectorRow,
} from './fixtures';

const COMMITMENT = vectorRow('setup-commitment.json', 'normal').expected as { commitment: Hex };
const ZERO_BODY_COMMITMENT = vectorRow('setup-commitment.json', 'zero-length-body').expected as { commitment: Hex };
const VECTOR_ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
const VECTOR_ACTION: Address = '0x2222222222222222222222222222222222222222';

/** Asserts the members every prepared call shares: the manager, zero value, the first pinned block, no simulation, no description. */
function expectManagerCall(call: PreparedCall, data: Hex, sender: 'account' | 'anyone'): void {
  const first = headerAt(FIRST_BLOCK);

  expect(call).toEqual({ kind: 'call', target: MANAGER, value: 0n, data, sender, block: { number: first.number, hash: first.hash } });
  expect('simulation' in call).toBe(false);
  expect('describes' in call).toBe(false);
}

/** Asserts the part read the read tag's block once and made no call, no code read and no log read. */
function expectOneBlockNoCall(provider: ProviderDouble, tag = 'latest'): void {
  expect(provider.blockTags).toEqual([tag]);
  expect(provider.calls).toEqual([]);
  expect(provider.codeReads).toBe(0);
  expect(provider.logReads).toBe(0);
}

describe('the part constructs nothing and reads nothing until asked', () => {
  it('makes no provider read in its constructor', () => {
    const provider = new ProviderDouble();

    partFor(provider);

    expect(provider.blockTags).toEqual([]);
    expect(provider.calls).toEqual([]);
    expect(provider.codeReads + provider.logReads + provider.chainIdReads).toBe(0);
  });
});

describe('the account-sent prepares encode the manager\'s own configuration functions', () => {
  it('prepareCommitSetup encodes commitSetup(address,bytes32,uint64,bytes,bytes) sent by the account', async () => {
    const provider = new ProviderDouble();
    const call = await partFor(provider).prepareCommitSetup(ACTION, COMMITMENT.commitment, 7n, '0x', '0xc0ffee');
    const expected = callData(
      SIGNATURES.commitSetup,
      [{ type: 'address' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes' }, { type: 'bytes' }],
      [ACTION, COMMITMENT.commitment, 7n, '0x', '0xc0ffee'],
    );

    expect(call.data.slice(0, 10)).toBe('0x11d78064');
    expectManagerCall(call, expected, 'account');
    expectOneBlockNoCall(provider);
  });

  it('prepareCommitSetup passes the metadata bytes through without judging them, the zero-length-body commitment included', async () => {
    const call = await partFor(new ProviderDouble()).prepareCommitSetup(ACTION, ZERO_BODY_COMMITMENT.commitment, 1n, '0x01', '0x');
    const expected = callData(
      SIGNATURES.commitSetup,
      [{ type: 'address' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes' }, { type: 'bytes' }],
      [ACTION, ZERO_BODY_COMMITMENT.commitment, 1n, '0x01', '0x'],
    );

    expect(call.data).toBe(expected);
  });

  it.each([
    ['prepareClearSetup', 'clearSetup', '0x002a237c'],
    ['prepareCancelByOwner', 'cancelByOwner', '0x2970c92b'],
  ] as const)('%s encodes %s(address,uint64) sent by the account, the second word encoded', async (member, signature, selector) => {
    const provider = new ProviderDouble();
    const call = await partFor(provider)[member](ACTION, 7n);

    expect(sel(signature)).toBe(selector);
    expect(call.data.slice(0, 10)).toBe(selector);
    expect(call.data.slice(-64)).toBe(7n.toString(16).padStart(64, '0'));
    expectManagerCall(call, callData(SIGNATURES[signature], [{ type: 'address' }, { type: 'uint64' }], [ACTION, 7n]), 'account');
    expectOneBlockNoCall(provider);
  });

  it.each([
    ['prepareClearSetup', 'clearSetup'],
    ['prepareCancelByOwner', 'cancelByOwner'],
  ] as const)('%s encodes the second word at both ends of uint64', async (member, signature) => {
    for (const value of [0n, (1n << 64n) - 1n]) {
      const call = await partFor(new ProviderDouble())[member](ACTION, value);

      expect(call.data).toBe(callData(SIGNATURES[signature], [{ type: 'address' }, { type: 'uint64' }], [ACTION, value]));
    }
  });
});

describe('the anyone-sent prepares encode the attempt functions', () => {
  it('prepareStartAttempt returns the blessed startAttempt calldata byte for byte, sent by anyone', async () => {
    const row = vectorRow('attempt-request.json', 'sorted-proofs');
    const provider = new ProviderDouble();
    const call = await partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).prepareStartAttempt(attemptRequestOf(row));
    const blessed = (row.expected as { calldata: Hex }).calldata;

    expectManagerCall(call, blessed, 'anyone');
    expect(callData(SIGNATURES.startAttempt, [ATTEMPT_REQUEST_PARAM], [tupleOf(attemptRequestOf(row))])).toBe(blessed);
    expectOneBlockNoCall(provider);
  });

  it('prepareCancelByProofs returns the blessed cancelByProofs calldata byte for byte, sent by anyone', async () => {
    const row = vectorRow('cancel-request.json', 'one-proof');
    const provider = new ProviderDouble();
    const call = await partFor(provider, VECTOR_ACCOUNT, VECTOR_ACTION).prepareCancelByProofs(cancelRequestOf(row));
    const blessed = (row.expected as { calldata: Hex }).calldata;

    expectManagerCall(call, blessed, 'anyone');
    expect(callData(SIGNATURES.cancelByProofs, [CANCEL_REQUEST_PARAM], [tupleOf(cancelRequestOf(row))])).toBe(blessed);
    expectOneBlockNoCall(provider);
  });

  it('prepareCancelByVeto encodes cancelByVeto(address,address,uint64,address) sent by anyone', async () => {
    const provider = new ProviderDouble();
    const call = await partFor(provider).prepareCancelByVeto(ACCOUNT, ACTION, 42n, METHOD);
    const expected = callData(
      SIGNATURES.cancelByVeto,
      [{ type: 'address' }, { type: 'address' }, { type: 'uint64' }, { type: 'address' }],
      [ACCOUNT, ACTION, 42n, METHOD],
    );

    expect(call.data.slice(0, 10)).toBe('0xc6cf95b6');
    expectManagerCall(call, expected, 'anyone');
    expectOneBlockNoCall(provider);
  });
});

describe('the pinned block of a prepare', () => {
  it('is the block the configured read tag resolved to, read once per prepare', async () => {
    const provider = new ProviderDouble();
    const part = partFor(provider, ACCOUNT, ACTION, { read: 'finalized', watch: 'latest' });
    const first = await part.prepareClearSetup(ACTION, 1n);
    const second = await part.prepareCancelByOwner(ACTION, 2n);

    expect(provider.blockTags).toEqual(['finalized', 'finalized']);
    expect(first.block).toEqual({ number: FIRST_BLOCK, hash: headerAt(FIRST_BLOCK).hash });
    expect(second.block).toEqual({ number: FIRST_BLOCK + 1, hash: headerAt(FIRST_BLOCK + 1).hash });
  });

  it('carries the block hash lower-cased when the provider answers it in upper case', async () => {
    const provider = new ProviderDouble();
    const upperHash = `0x${'AB'.repeat(32)}` as Hex;

    provider.block = async (tag) => {
      provider.blockTags.push(tag);

      return { number: 5, timestamp: 9, hash: upperHash };
    };

    const call = await partFor(provider).prepareClearSetup(ACTION, 1n);

    expect(call.block).toEqual({ number: 5, hash: upperHash.toLowerCase() });
  });
});

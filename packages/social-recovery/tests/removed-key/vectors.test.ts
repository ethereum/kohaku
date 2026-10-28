import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  AmbireActionCodec,
  EventManager,
  inferRemovedKey,
  type Address,
  type Hex,
  type IProvider,
  type RawLog,
  type RawTransaction,
  type RemovedKeyInputs,
} from '../../src/index';
import { encodeEvent, rawLog, type EventName } from '../event-manager/fixture';
import { readVector } from '../kat/read-vector';
import { BLOCK, DESCRIPTOR, keySet } from './doubles';

type EventRow = { readonly 'id': string; readonly input: Readonly<Record<string, unknown>>; readonly expected: { readonly topics: readonly Hex[]; readonly data: Hex } };

const EVENTS = readVector('manager-events.json').vectors as readonly EventRow[];
const HANDOVERS = readVector('ambire-handover.json').vectors;

const row = (name: string): EventRow => {
  const found = EVENTS.find((one) => one['id'] === name);

  if (found === undefined) throw new Error(`manager-events.json has no ${name} row`);

  return found;
};

const handoverRow = (name: string): Readonly<Record<string, unknown>> => {
  const found = HANDOVERS.find((one) => one['id'] === name);

  if (found === undefined) throw new Error(`ambire-handover.json has no ${name} row`);

  return found as unknown as Readonly<Record<string, unknown>>;
};

const VECTOR_ACCOUNT = getAddress(String(row('AttemptStarted').input['account']));
const VECTOR_ACTION = getAddress(String(row('AttemptStarted').input['action']));
const NORMAL_ENCODED = (handoverRow('normal')['expected'] as { encoded: Hex }).encoded;
const NORMAL_NEW = getAddress(String((handoverRow('normal')['input'] as Record<string, unknown>)['newAuthority']));
const NORMAL_REMOVED = getAddress(String((handoverRow('normal')['input'] as Record<string, unknown>)['removedAuthority']));
const TRAILING_ENCODED = (handoverRow('trailing-byte')['input'] as { encoded: Hex }).encoded;

/** A log carrying a vector row's own topics and data, emitted by the manager at a block. */
const rowLog = (name: string, block: number): RawLog =>
  rawLog(DESCRIPTOR.manager, row(name).expected.topics, row(name).expected.data, { blockNumber: block });

/** The vector's `AttemptStarted` row re-encoded with another payload, every other field the row's own. */
const startedWith = (payload: Hex, block: number): RawLog => {
  const input = row('AttemptStarted').input;
  const order = input['order'] as Record<string, unknown>;
  const args = {
    ...input,
    attemptId: BigInt(String(input['attemptId'])),
    setupNonce: BigInt(String(input['setupNonce'])),
    usedPlaces: (input['usedPlaces'] as string[]).map((one) => BigInt(one)),
    order: { ...order, amount: BigInt(String(order['amount'])) },
    payload,
  };
  const { topics, data } = encodeEvent('AttemptStarted' as EventName, args);

  return rawLog(DESCRIPTOR.manager, topics, data, { blockNumber: block });
};

/** A chain answering logs and transactions from fixed lists, recording the hashes asked for. */
const chain = (logs: readonly RawLog[]): { provider: IProvider; asked: Hex[] } => {
  const asked: Hex[] = [];
  const known = new Map<string, RawTransaction>(
    logs.map((log) => [
      log.transactionHash.toLowerCase(),
      { hash: log.transactionHash, from: VECTOR_ACCOUNT, to: VECTOR_ACCOUNT, input: '0x', blockNumber: log.blockNumber, blockHash: log.blockHash },
    ]),
  );

  return {
    asked,
    provider: {
      chainId: () => Promise.reject(new Error('not the inference\'s')),
      call: () => Promise.reject(new Error('not the inference\'s')),
      block: () => Promise.reject(new Error('not the inference\'s')),
      code: () => Promise.reject(new Error('not the inference\'s')),
      logs: async (_filter, range) => logs.filter((log) => log.blockNumber >= range.from && log.blockNumber <= range.to),
      transaction: async (hash) => {
        asked.push(hash);

        return known.get(hash.toLowerCase());
      },
    },
  };
};

/** The inference over the real event manager and codec, bound to the vector rows' account and action. */
const inputsFor = (logs: readonly RawLog[], authorities: readonly Address[], signer?: Address): { inputs: RemovedKeyInputs; asked: Hex[]; askedKeys: string[] } => {
  const { provider, asked } = chain(logs);
  const descriptor = { ...DESCRIPTOR, action: VECTOR_ACTION, auditedActions: [VECTOR_ACTION] };
  const events = new EventManager(provider, descriptor, VECTOR_ACCOUNT, VECTOR_ACTION, new Map(), { logChunkSize: 50 });
  const allowed = keySet(...authorities);
  const askedKeys: string[] = [];

  return {
    asked,
    askedKeys,
    inputs: {
      events,
      action: {
        isAuthority: async (candidate) => {
          askedKeys.push(candidate.toLowerCase());

          return allowed.has(candidate.toLowerCase());
        },
      },
      codec: new AmbireActionCodec([VECTOR_ACTION]),
      provider,
      ...(signer === undefined ? {} : { signerRecovery: { recoverSigner: async () => signer } }),
      descriptor,
      account: VECTOR_ACCOUNT,
      actionAddress: VECTOR_ACTION,
    },
  };
};

describe('the blessed manager events through the real event manager', () => {
  it('the vector pair with its foreign payload names nothing in step 1', async () => {
    const { inputs, askedKeys } = inputsFor([rowLog('AttemptStarted', 200), rowLog('AttemptConsumed', 201)], [NORMAL_NEW]);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
    expect(askedKeys).toEqual([]);
  });

  it('the pair carrying the normal handover payload names its new key, never its removed key', async () => {
    const { inputs, askedKeys } = inputsFor([startedWith(NORMAL_ENCODED, 200), rowLog('AttemptConsumed', 201)], [NORMAL_NEW, NORMAL_REMOVED]);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(NORMAL_NEW);
    expect(askedKeys).toEqual([NORMAL_NEW.toLowerCase()]);
  });

  it('the normal handover\'s new key denied: not-a-key, the removed key never asked', async () => {
    const { inputs, askedKeys } = inputsFor([startedWith(NORMAL_ENCODED, 200), rowLog('AttemptConsumed', 201)], [NORMAL_REMOVED]);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('not-a-key');
    expect(askedKeys).toEqual([NORMAL_NEW.toLowerCase()]);
  });

  it('the trailing-byte payload names nothing', async () => {
    const { inputs, askedKeys } = inputsFor([startedWith(TRAILING_ENCODED, 200), rowLog('AttemptConsumed', 201)], [NORMAL_NEW]);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
    expect(askedKeys).toEqual([]);
  });

  it('a removed consumed log leaves the normal handover unconsumed', async () => {
    const consumedLog = { ...rowLog('AttemptConsumed', 201), removed: true };
    const { inputs } = inputsFor([startedWith(NORMAL_ENCODED, 200), consumedLog], [NORMAL_NEW]);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe('no-source');
  });

  it('the SetupCommitted row\'s transaction hash is the one transaction asks for', async () => {
    const commit = rowLog('SetupCommitted', 300);
    const signer = getAddress(`0x${'9'.repeat(40)}`);
    const { inputs, asked } = inputsFor([rowLog('AttemptStarted', 200), rowLog('AttemptConsumed', 201), commit], [signer], signer);

    await expect(inferRemovedKey(inputs, BLOCK)).resolves.toBe(signer);
    expect(asked.map((hash) => hash.toLowerCase())).toEqual([commit.transactionHash.toLowerCase()]);
  });
});

import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { EventManager, type Address, type Configuration, type Hex, type IProvider, type RawLog } from '../../src/index';
import { readVector } from '../kat/read-vector';
import {
  CONFIGURATION,
  DESCRIPTOR,
  KEY_NEW,
  KEY_OLD,
  ORDER,
  referenceBody,
  referenceCommitment,
  referenceCredential,
  referenceEncodeBody,
  rig,
  SETUP_NONCE,
  stateFor,
  world,
} from './doubles';

type Row = { readonly 'id'?: string; readonly input: Readonly<Record<string, unknown>>; readonly expected: Readonly<Record<string, unknown>> };

const rowOf = (file: string, name: string): Row => {
  const found = readVector(file).vectors.find((one) => one['id'] === name);

  if (found === undefined) throw new Error(`${file} has no ${name} row`);

  return found as unknown as Row;
};

const HANDOVER_ROW = rowOf('ambire-handover.json', 'normal');
const STARTED_ROW = rowOf('manager-events.json', 'AttemptStarted');
const CONSUMED_ROW = rowOf('manager-events.json', 'AttemptConsumed');
const CREDENTIAL_ROW = rowOf('credential-commitment.json', 'normal');
const COMMITMENT_ROW = rowOf('setup-commitment.json', 'normal');
const BODY_ROW = rowOf('setup-body.json', 'two-clauses');

const ROW_NEW = getAddress(String(HANDOVER_ROW.input['newAuthority']));
const ROW_REMOVED = getAddress(String(HANDOVER_ROW.input['removedAuthority']));
const ROW_ENCODED = String(HANDOVER_ROW.expected['encoded']) as Hex;
const VECTOR_ACCOUNT = getAddress(String(STARTED_ROW.input['account']));
const VECTOR_ACTION = getAddress(String(STARTED_ROW.input['action']));

const STARTED_ABI = parseAbi([
  'struct PaymentOrder { address token; uint256 amount; address payee; }',
  'event AttemptStarted(address indexed _account, address indexed _action, uint64 _attemptId, uint64 _setupNonce, bytes _setupBody, uint256[] _usedPlaces, address[] _usedMethods, bytes _payload, PaymentOrder _order, uint48 _consumableAfter)',
]);

/** The non-indexed members of `AttemptStarted`, in declaration order. */
const STARTED_DATA_ABI = [
  { type: 'uint64' },
  { type: 'uint64' },
  { type: 'bytes' },
  { type: 'uint256[]' },
  { type: 'address[]' },
  { type: 'bytes' },
  { type: 'tuple', components: [{ type: 'address' }, { type: 'uint256' }, { type: 'address' }] },
  { type: 'uint48' },
] as const;

/** The `AttemptStarted` row encoded by viem with the given payload, every other field the row's own. */
function startedLog(payload: Hex): { readonly topics: Hex[]; readonly data: Hex } {
  const input = STARTED_ROW.input;
  const order = input['order'] as Record<string, string>;
  const topics = encodeEventTopics({ abi: STARTED_ABI, eventName: 'AttemptStarted', args: { _account: VECTOR_ACCOUNT, _action: VECTOR_ACTION } });
  const data = encodeAbiParameters(
    STARTED_DATA_ABI,
    [
      BigInt(String(input['attemptId'])),
      BigInt(String(input['setupNonce'])),
      input['setupBody'] as Hex,
      (input['usedPlaces'] as string[]).map((one) => BigInt(one)),
      input['usedMethods'] as Address[],
      payload,
      [order['token'] as Address, BigInt(order['amount'] as string), order['payee'] as Address],
      Number(input['consumableAfter']),
    ],
  );

  return { topics: topics as Hex[], data };
}

const rawLog = (topics: readonly Hex[], data: Hex, block: number): RawLog => ({
  address: DESCRIPTOR.manager,
  topics,
  data,
  blockNumber: block,
  blockHash: `0x${block.toString(16).padStart(64, '0')}`,
  logIndex: 0,
  transactionHash: `0x${(block * 7).toString(16).padStart(64, '0')}`,
});

/** A real event manager over the vector pair, served the given logs inside each read's range. */
function realEvents(logs: readonly RawLog[]): EventManager {
  const unused = async (): Promise<never> => {
    throw new Error('the event manager reads logs only');
  };
  const provider: IProvider = {
    chainId: unused,
    call: unused,
    block: unused,
    code: unused,
    transaction: unused,
    logs: async (_filter, range) => logs.filter((log) => log.blockNumber >= range.from && log.blockNumber <= range.to),
  };

  return new EventManager(provider, { ...DESCRIPTOR, action: VECTOR_ACTION, auditedActions: [VECTOR_ACTION] }, VECTOR_ACCOUNT, VECTOR_ACTION, new Map(), {
    logChunkSize: 1_000,
  });
}

/** The vector pair's reading with `CONFIGURATION` standing for that pair. */
const vectorState = (configuration: Configuration) => ({
  ...stateFor(configuration),
  setupCommitment: referenceCommitment(VECTOR_ACCOUNT, VECTOR_ACTION, SETUP_NONCE, referenceEncodeBody(referenceBody(configuration, VECTOR_ACCOUNT))),
});

describe('vectors the inits reproduce', () => {
  it('the independent references reproduce their own rows', () => {
    const credential = CREDENTIAL_ROW.input as Record<string, Hex>;

    expect(referenceCredential(credential['method'] as Address, credential['config'] as Hex, credential['salt'] as Hex)).toBe(CREDENTIAL_ROW.expected['commitment']);
    expect(
      referenceCommitment(
        COMMITMENT_ROW.input['account'] as Address,
        COMMITMENT_ROW.input['action'] as Address,
        BigInt(String(COMMITMENT_ROW.input['nonce'])),
        COMMITMENT_ROW.input['setupBody'] as Hex,
      ),
    ).toBe(COMMITMENT_ROW.expected['commitment']);

    const body = BODY_ROW.input as { wait: string; ignoresPause: boolean; clauses: { threshold: number; credentials: Hex[] }[] };

    expect(referenceEncodeBody({ wait: Number(body.wait), ignoresPause: body.ignoresPause, clauses: body.clauses })).toBe(BODY_ROW.expected['encoded']);
    expect(startedLog(STARTED_ROW.input['payload'] as Hex)).toEqual(STARTED_ROW.expected);
  });

  it('the payload of the normal handover row is the row encoding', async () => {
    const built = rig(world({ authorities: new Set([ROW_REMOVED.toLowerCase()]) }));
    const record = await built.client.initRecoveryGathering(CONFIGURATION, { newAuthority: ROW_NEW, removedAuthority: ROW_REMOVED }, ORDER, {
      window: 3_600,
    });

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(record.request.payload.toLowerCase()).toBe(ROW_ENCODED.toLowerCase());
  });

  it('a place carrying the credential row commits to the row commitment in the record body', async () => {
    const credential = CREDENTIAL_ROW.input as Record<string, Hex>;
    const configuration: Configuration = {
      clauses: [{ threshold: 1, credentials: [{ method: credential['method'] as Address, config: credential['config'] as Hex, salt: credential['salt'] as Hex }] }],
      wait: 172_800,
      ignoresPause: false,
    };
    const record = await rig(world({ state: stateFor(configuration) })).client.initRecoveryGathering(configuration, { newAuthority: KEY_NEW, removedAuthority: KEY_OLD }, ORDER, { window: 3_600 });
    const expectedBody = referenceEncodeBody({ wait: 172_800, ignoresPause: false, clauses: [{ threshold: 1, credentials: [CREDENTIAL_ROW.expected['commitment'] as Hex] }] });

    expect(record.request.setupBody.toLowerCase()).toBe(expectedBody.toLowerCase());
  });

  it('the vector AttemptStarted carrying the normal row, then consumed, names the row new key as the one removed', async () => {
    const started = startedLog(ROW_ENCODED);
    const consumedRow = CONSUMED_ROW.expected as { topics: Hex[]; data: Hex };
    const events = realEvents([rawLog(started.topics, started.data, 200), rawLog(consumedRow.topics, consumedRow.data, 201)]);
    const built = rig(world({ state: vectorState(CONFIGURATION), authorities: new Set([ROW_NEW.toLowerCase()]) }), undefined, {
      account: VECTOR_ACCOUNT,
      action: VECTOR_ACTION,
      descriptor: { ...DESCRIPTOR, action: VECTOR_ACTION, auditedActions: [VECTOR_ACTION] },
      events,
    });
    const record = await built.client.initRecoveryGathering(CONFIGURATION, { newAuthority: KEY_NEW }, ORDER, { window: 3_600 });

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(built.codec.decode(record.request.payload)).toEqual({ newAuthority: KEY_NEW, removedAuthority: ROW_NEW });
  });
});

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashTypedData } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  approvalDigest,
  approvalTypedData,
  cancellationDigest,
  cancellationTypedData,
  credentialHash,
  decodeSetupBody,
  DIGEST_VERSION,
  encodeSetupBody,
  setupBodyHash,
  setupCommitment,
  type ApprovalMembers,
  type CancellationMembers,
  type Hex,
  type SetupBody,
} from '../../src/index';
import { readVector } from '../kat/read-vector';
import { keccakLocal } from './support';

/** The row key, read as a string because the root lint forbids `id` as an identifier. */
const ROW_KEY = 'id';

type Row = Record<typeof ROW_KEY, string> & { input: Record<string, unknown>; expected: Record<string, unknown> };
type VectorFile = { format: string; derivation: string; blessed?: boolean; vectors: Row[] };
type Loaded = { file: VectorFile; source: string };

function loadBlessed(name: string): Loaded {
  return { file: readVector(name) as unknown as VectorFile, source: `tests/kat/vectors/${name}` };
}

function loadFixture(name: string): Loaded {
  const path = fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

  return { file: JSON.parse(readFileSync(path, 'utf8')) as VectorFile, source: `tests/formats/fixtures/${name}` };
}

const str = (value: unknown): string => value as string;

type Domain = { name: string; version: string; chainId: number; verifyingContract: Hex };
type Order = { token: Hex; amount: string; payee: Hex };

/** The two digests' EIP-712 types, written by hand from the manager's type strings. */
const PAYMENT_ORDER_FIELDS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'payee', type: 'address' },
] as const;
const CANCELLATION_FIELDS = [
  { name: 'account', type: 'address' },
  { name: 'action', type: 'address' },
  { name: 'attemptId', type: 'uint64' },
  { name: 'setupNonce', type: 'uint64' },
  { name: 'setupBodyHash', type: 'bytes32' },
  { name: 'validUntil', type: 'uint48' },
  { name: 'place', type: 'uint256' },
] as const;
const APPROVAL_FIELDS = [
  { name: 'account', type: 'address' },
  { name: 'action', type: 'address' },
  { name: 'attemptId', type: 'uint64' },
  { name: 'setupNonce', type: 'uint64' },
  { name: 'setupBodyHash', type: 'bytes32' },
  { name: 'payload', type: 'bytes' },
  { name: 'order', type: 'PaymentOrder' },
  { name: 'validUntil', type: 'uint48' },
  { name: 'place', type: 'uint256' },
] as const;

/** Whether a row's place lies past the safe integers, where only the `bigint` form carries it. */
const beyondSafe = (place: bigint): boolean => place > BigInt(Number.MAX_SAFE_INTEGER);

/** The row's digest by viem over the hand-written types, the place kept as the uint256 it is. */
function independentDigest(primaryType: 'Approval' | 'Cancellation', members: ApprovalMembers, place: bigint, domain: Domain): Hex {
  const common = {
    account: members.account,
    action: members.action,
    attemptId: members.attemptId,
    setupNonce: members.setupNonce,
    setupBodyHash: members.setupBodyHash,
    validUntil: members.validUntil,
    place,
  };

  return primaryType === 'Approval'
    ? hashTypedData({
      domain,
      types: { Approval: APPROVAL_FIELDS, PaymentOrder: PAYMENT_ORDER_FIELDS },
      primaryType,
      message: { ...common, payload: members.payload, order: members.order },
    })
    : hashTypedData({ domain, types: { Cancellation: CANCELLATION_FIELDS }, primaryType, message: common });
}

function membersOf(input: Record<string, unknown>): { members: ApprovalMembers; rawPlace: bigint; domain: Domain } {
  const domain = input['domain'] as Domain;
  const message = input['message'] as Record<string, unknown>;
  const order = message['order'] as Order | undefined;
  const base: CancellationMembers = {
    chainId: domain.chainId,
    manager: domain.verifyingContract,
    account: str(message['account']) as Hex,
    action: str(message['action']) as Hex,
    attemptId: BigInt(str(message['attemptId'])),
    setupNonce: BigInt(str(message['setupNonce'])),
    setupBodyHash: str(message['setupBodyHash']) as Hex,
    validUntil: Number(str(message['validUntil'])),
  };
  const members: ApprovalMembers = {
    ...base,
    payload: (message['payload'] ?? '0x') as Hex,
    order: order
      ? { token: order.token, amount: BigInt(order.amount), payee: order.payee }
      : { token: '0x0000000000000000000000000000000000000000', amount: 0n, payee: '0x0000000000000000000000000000000000000000' },
  };

  return { members, rawPlace: BigInt(str(message['place'])), domain };
}

type Replayer = (row: Row) => void;

const REPLAYERS: Record<string, Replayer> = {
  'credential-commitment-v1': ({ input, expected }) => {
    expect(keccakLocal(str(expected['preimage']))).toBe(expected['commitment']);
    expect(credentialHash(str(input['method']) as Hex, str(input['config']) as Hex, str(input['salt']) as Hex)).toBe(
      expected['commitment'],
    );
  },
  'setup-body-v1': ({ input, expected }) => {
    const body: SetupBody = {
      wait: Number(str(input['wait'])),
      ignoresPause: input['ignoresPause'] as boolean,
      clauses: input['clauses'] as SetupBody['clauses'],
    };

    expect(encodeSetupBody(body)).toBe(expected['encoded']);
    expect(decodeSetupBody(str(expected['encoded']) as Hex)).toEqual(body);
  },
  'setup-commitment-v1': ({ input, expected }) => {
    expect(keccakLocal(str(expected['preimage']))).toBe(expected['commitment']);
    expect(
      setupCommitment(
        str(input['account']) as Hex,
        str(input['action']) as Hex,
        BigInt(str(input['nonce'])),
        str(input['setupBody']) as Hex,
      ),
    ).toBe(expected['commitment']);
  },
  'approval-digest-v1': ({ input, expected }) => {
    const { members, rawPlace, domain } = membersOf(input);

    expect(independentDigest('Approval', members, rawPlace, domain)).toBe(expected['digest']);

    const typed = approvalTypedData(members, rawPlace);

    expect(domain.name).toBe('PolicyManager');
    expect(domain.version).toBe(DIGEST_VERSION);
    expect(typed.domain).toStrictEqual(domain);
    expect(typed.primaryType).toBe('Approval');
    expect(typed.message.place).toBe(rawPlace);
    expect(hashTypedData(typed)).toBe(expected['digest']);
    expect(approvalDigest(members, rawPlace)).toBe(expected['digest']);

    if (!beyondSafe(rawPlace)) expect(approvalDigest(members, Number(rawPlace))).toBe(expected['digest']);
  },
  'cancellation-digest-v1': ({ input, expected }) => {
    const { members, rawPlace, domain } = membersOf(input);

    expect(independentDigest('Cancellation', members, rawPlace, domain)).toBe(expected['digest']);

    const typed = cancellationTypedData(members, rawPlace);

    expect(Object.keys(input['message'] as object)).not.toContain('payload');
    expect(domain.version).toBe(DIGEST_VERSION);
    expect(typed.domain).toStrictEqual(domain);
    expect(typed.primaryType).toBe('Cancellation');
    expect(typed.message.place).toBe(rawPlace);
    expect(hashTypedData(typed)).toBe(expected['digest']);
    expect(cancellationDigest(members, rawPlace)).toBe(expected['digest']);

    if (!beyondSafe(rawPlace)) expect(cancellationDigest(members, Number(rawPlace))).toBe(expected['digest']);
  },
};

const BLESSED = [
  'credential-commitment.json',
  'setup-body.json',
  'setup-commitment.json',
  'approval-digest.json',
  'cancellation-digest.json',
];

const FIXTURES = [
  'credential-commitment-boundaries.json',
  'setup-body-boundaries.json',
  'setup-commitment-boundaries.json',
  'approval-digest-boundaries.json',
  'cancellation-digest-boundaries.json',
];

function replay(title: string, loaded: Loaded, blessed: boolean): void {
  describe(`${title} (${loaded.source})`, () => {
    const { file } = loaded;

    it('names a known format and carries at least one row (no vacuous match)', () => {
      expect(Object.keys(REPLAYERS)).toContain(file.format);
      expect(file.vectors.length).toBeGreaterThan(0);
      expect(file.blessed === false).toBe(!blessed);
    });

    it.each(file.vectors.map((row) => [row[ROW_KEY], row] as const))('row %s', (_rowId, row) => {
      const replayer = REPLAYERS[file.format];

      expect(replayer).toBeDefined();
      replayer?.(row);
    });
  });
}

describe('blessed vectors (copies under tests/kat/vectors)', () => {
  for (const name of BLESSED) replay(name, loadBlessed(name), true);

  const body = loadBlessed('setup-body.json').file;
  const commitment = loadBlessed('setup-commitment.json').file;
  const approval = loadBlessed('approval-digest.json').file;

  it('one body is hashed on both sides: commitment row and digest member', () => {
    const encoded = str(body.vectors.find((row) => row[ROW_KEY] === 'two-clauses')?.expected['encoded']) as Hex;
    const committed = commitment.vectors.find((row) => row[ROW_KEY] === 'normal')?.input['setupBody'];
    const message = approval.vectors[0]?.input['message'] as Record<string, unknown>;

    expect(committed).toBe(encoded);
    expect(setupBodyHash(encoded)).toBe(message['setupBodyHash']);
  });
});

describe('tester-authored vectors (tests/formats/fixtures, blessed: false)', () => {
  for (const name of FIXTURES) replay(name, loadFixture(name), false);
});

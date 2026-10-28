import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeAbiParameters, encodeAbiParameters, getAddress, hashTypedData, keccak256 } from 'viem';
import type { Address, Gathering, GatheringPlace, Hex, Reply } from '../../src/index';
import { readVector, type VectorFile } from '../kat/read-vector';

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Reads one tester-authored fixture file under `tests/gathering/fixtures`; a missing file throws. */
export function readFixture(fileName: string): VectorFile {
  const parsed = JSON.parse(readFileSync(join(FIXTURES_DIR, fileName), 'utf8')) as VectorFile;

  if (parsed['blessed'] !== false || !Array.isArray(parsed.vectors)) throw new Error(`fixture ${fileName} is malformed`);

  return parsed;
}

/** A blessed vector row's input, by row name. */
export function vectorInput(fileName: string, rowName: string): Record<string, unknown> {
  const row = readVector(fileName).vectors.find((r) => r['id'] === rowName);

  if (row === undefined) throw new Error(`${fileName} has no row ${rowName}`);

  return row.input;
}

/** A blessed vector row's expected member, by row name. */
export function vectorExpected(fileName: string, rowName: string): Record<string, unknown> {
  const row = readVector(fileName).vectors.find((r) => r['id'] === rowName);

  if (row === undefined) throw new Error(`${fileName} has no row ${rowName}`);

  return row.expected as Record<string, unknown>;
}

export const MANAGER: Address = '0x6666666666666666666666666666666666666666';
export const ACCOUNT: Address = '0x1111111111111111111111111111111111111111';
export const ACTION: Address = '0x2222222222222222222222222222222222222222';
export const METHOD: Address = '0x3333333333333333333333333333333333333333';
export const OTHER_METHOD: Address = '0x7777777777777777777777777777777777777777';
export const TOKEN: Address = '0x4444444444444444444444444444444444444444';
export const PAYEE: Address = '0x5555555555555555555555555555555555555555';

/** The blessed approval row's window end. */
export const VALID_UNTIL = 1_800_000_000;

/** A pinned block a day before the blessed window end. */
export const PINNED_AT = VALID_UNTIL - 86_400;

/** The shipped moment-skew span: 15 minutes. */
export const SKEW_SPAN = 900;

/** One hour, the shipped request-window floor. */
export const FLOOR = 3_600;

/** The blessed two-clause body: place 0 alone at threshold 1, places 1..3 at threshold 2. */
export const TWO_CLAUSES_BODY = (vectorExpected('setup-body.json', 'two-clauses')['encoded'] as Hex);

const CLAUSES_ABI = [
  { type: 'uint48' },
  { type: 'bool' },
  { type: 'tuple[]', components: [{ name: 'threshold', type: 'uint8' }, { name: 'credentials', type: 'bytes32[]' }] },
] as const;

/** The credential hash preimage's parameters, written out independently of the package. */
export const CREDENTIAL_TEST_ABI = [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }] as const;

/** The default salt preimage's parameters, written out independently of the package. */
export const DEFAULT_SALT_TEST_ABI = [{ type: 'address' }, { type: 'uint256' }] as const;

/** A setup body by viem's encoder. */
export const encodeBody = (clauses: readonly { threshold: number; credentials: readonly Hex[] }[], wait = 172_800, ignoresPause = false): Hex =>
  encodeAbiParameters(CLAUSES_ABI, [wait, ignoresPause, clauses.map((c) => ({ ...c, credentials: [...c.credentials] }))]);

/** A credential hash by viem's encoder. */
export const credentialOf = (method: Address, config: Hex, salt: Hex): Hex =>
  keccak256(encodeAbiParameters(CREDENTIAL_TEST_ABI, [method, config, salt]));

/** A body over the given clauses of places, each credential hashed from the place-map entry at that place. */
export function bodyOver(
  clauses: readonly { threshold: number; places: readonly number[] }[],
  places: readonly GatheringPlace[],
  ignoresPause = false,
): Hex {
  const hashAt = (place: number): Hex => {
    const entry = places.find((p) => p.place === place);

    return entry === undefined ? `0x${place.toString(16).padStart(64, '0')}` : credentialOf(entry.method, entry.config, entry.salt);
  };

  return encodeBody(clauses.map((c) => ({ threshold: c.threshold, credentials: c.places.map(hashAt) })), 172_800, ignoresPause);
}

/** Each clause's threshold and its places, from an encoded body by viem's decoder and the flat numbering. */
export function ruleOf(body: Hex): { threshold: number; places: number[] }[] {
  const [, , clauses] = decodeAbiParameters(CLAUSES_ABI, body);
  let next = 0;

  return clauses.map((c) => ({ threshold: c.threshold, places: c.credentials.map(() => next++) }));
}

/** The manager's rule written out: every clause meets its threshold, and no clauses or all-zero thresholds fail. */
export function ruleHolds(body: Hex, filled: readonly number[]): boolean {
  const rule = ruleOf(body);

  if (rule.length === 0 || rule.every((c) => c.threshold === 0)) return false;

  return rule.every((c) => c.places.filter((p) => filled.includes(p)).length >= c.threshold);
}

/** A checksummed method address standing for method number `index`. */
export const methodAt = (index: number): Address => getAddress(`0x${(0xabc0 + index).toString(16).padStart(40, '0')}`);

/** A config byte string unique to a place. */
export const configAt = (place: number): Hex => `0x${(place + 0xa0).toString(16).padStart(4, '0')}`;

/** A salt unique to a place. */
export const saltAt = (place: number): Hex => `0x${(place + 1).toString(16).padStart(64, '0')}`;

/** A place-map entry with distinct method inputs per place. */
export function placeEntry(place: number, overrides: Partial<GatheringPlace> = {}): GatheringPlace {
  return {
    place,
    method: METHOD,
    config: configAt(place),
    salt: saltAt(place),
    label: `person ${place}`,
    standing: 'not-stopped',
    stoppable: false,
    credentialHoldsCode: place % 2 === 1,
    ...overrides,
  };
}

/** The shared request members of the blessed digest rows, with the body given. */
function members(body: Hex) {
  return {
    chainId: '1',
    manager: MANAGER,
    digestVersion: '1',
    account: ACCOUNT,
    action: ACTION,
    attemptId: '9',
    setupNonce: '7',
    setupBody: body,
    validUntil: String(VALID_UNTIL),
    block: { number: 21_000_000, timestamp: String(PINNED_AT), hash: `0x${'bb'.repeat(32)}` as Hex },
  };
}

/** A gathering under the approval purpose. */
export type ApprovalGathering = Extract<Gathering, { purpose: 'approval' }>;

/** A gathering under the cancellation purpose. */
export type CancellationGathering = Extract<Gathering, { purpose: 'cancellation' }>;

/** An approval gathering over the blessed members; with the default body, place 0 digests to the blessed row. */
export function approvalGathering(
  places: readonly GatheringPlace[] = [0, 1, 2, 3].map((p) => placeEntry(p)),
  body: Hex = TWO_CLAUSES_BODY,
  replies: readonly Reply[] = [],
): ApprovalGathering {
  return {
    kind: 'gathering',
    version: 1,
    purpose: 'approval',
    request: {
      ...members(body),
      payload: '0xabcdef',
      order: { token: TOKEN, amount: '1234567890123456789', payee: PAYEE },
    },
    places,
    replies,
  };
}

/** A cancellation gathering over the blessed members, its attempt spendable at the window end unless given. */
export function cancellationGathering(
  places: readonly GatheringPlace[] = [0, 1, 2, 3].map((p) => placeEntry(p)),
  body: Hex = TWO_CLAUSES_BODY,
  consumableAfter: number = VALID_UNTIL,
): CancellationGathering {
  return {
    kind: 'gathering',
    version: 1,
    purpose: 'cancellation',
    request: { ...members(body), consumableAfter: String(consumableAfter) },
    places,
    replies: [],
  };
}

const DOMAIN_TYPES = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
] as const;

const APPROVAL_TYPES = {
  EIP712Domain: DOMAIN_TYPES,
  PaymentOrder: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'payee', type: 'address' },
  ],
  Approval: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'address' },
    { name: 'attemptId', type: 'uint64' },
    { name: 'setupNonce', type: 'uint64' },
    { name: 'setupBodyHash', type: 'bytes32' },
    { name: 'payload', type: 'bytes' },
    { name: 'order', type: 'PaymentOrder' },
    { name: 'validUntil', type: 'uint48' },
    { name: 'place', type: 'uint256' },
  ],
} as const;

const CANCELLATION_TYPES = {
  EIP712Domain: DOMAIN_TYPES,
  Cancellation: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'address' },
    { name: 'attemptId', type: 'uint64' },
    { name: 'setupNonce', type: 'uint64' },
    { name: 'setupBodyHash', type: 'bytes32' },
    { name: 'validUntil', type: 'uint48' },
    { name: 'place', type: 'uint256' },
  ],
} as const;

/** The digest a place of a gathering must carry, by viem's hashTypedData over hand-written types. */
export function digestOf(record: Gathering, place: number): Hex {
  const r = record.request;
  const domain = { name: 'PolicyManager', version: r.digestVersion, chainId: BigInt(r.chainId), verifyingContract: r.manager };
  const common = {
    account: r.account,
    action: r.action,
    attemptId: BigInt(r.attemptId),
    setupNonce: BigInt(r.setupNonce),
    setupBodyHash: keccak256(r.setupBody),
    validUntil: Number(r.validUntil),
    place: BigInt(place),
  };

  if (record.purpose === 'approval') {
    const { order } = record.request;

    return hashTypedData({
      domain,
      types: APPROVAL_TYPES,
      primaryType: 'Approval',
      message: { ...common, payload: record.request.payload, order: { ...order, amount: BigInt(order.amount) } },
    });
  }

  return hashTypedData({ domain, types: CANCELLATION_TYPES, primaryType: 'Cancellation', message: common });
}

/** A reply that fits a place of a gathering exactly, with the digest computed independently. */
export function replyFor(record: Gathering, place: number, overrides: Partial<Reply> = {}): Reply {
  const entry = record.places.find((p) => p.place === place);
  const r = record.request;

  return {
    kind: 'recovery-proof-reply',
    version: 1,
    chainId: r.chainId,
    manager: r.manager,
    account: r.account,
    action: r.action,
    attemptId: r.attemptId,
    purpose: record.purpose,
    place,
    method: entry?.method ?? METHOD,
    config: entry?.config ?? configAt(place),
    salt: entry?.salt ?? saltAt(place),
    digest: digestOf(record, place),
    proof: `0x${(place + 0xd0).toString(16)}`,
    ...overrides,
  };
}

/** Freezes a value and everything reachable from it. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);

    for (const inner of Object.values(value)) deepFreeze(inner);
  }

  return value;
}

/** Every object and array reachable from a value. */
export function objectsIn(value: unknown, seen: Set<object> = new Set()): Set<object> {
  if (typeof value === 'object' && value !== null && !seen.has(value)) {
    seen.add(value);

    for (const inner of Object.values(value)) objectsIn(inner, seen);
  }

  return seen;
}

/** The objects two values share by reference. */
export function sharedObjects(output: unknown, input: unknown): object[] {
  const inputs = objectsIn(input);

  return [...objectsIn(output)].filter((o) => inputs.has(o));
}

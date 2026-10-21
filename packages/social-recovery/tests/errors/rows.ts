import { encodeAbiParameters, getAddress, type AbiParameter } from 'viem';
import type { Hex, KitErrorSource, KitErrorValue } from '../../src/index';

/** One expected error: its selector computed from the signature text, its arguments as name and type, and who raises it. */
export type ErrorRow = {
  readonly name: string;
  readonly selector: Hex;
  readonly inputs: readonly { readonly name: string; readonly type: string }[];
  readonly source: KitErrorSource;
};

const row = (name: string, selector: Hex, source: KitErrorSource, inputs: readonly (readonly [string, string])[]): ErrorRow => ({
  name,
  selector,
  source,
  inputs: inputs.map(([argument, type]) => ({ name: argument, type })),
});

/** The manager's twenty-two errors, in their declaration order. */
export const MANAGER_ROWS: readonly ErrorRow[] = [
  row('PolicyManager_InvalidCommitment', '0x755fed9c', 'manager', [['supplied', 'bytes32']]),
  row('PolicyManager_WrongSetupNonce', '0x9609057d', 'manager', [['supplied', 'uint64'], ['expected', 'uint64']]),
  row('PolicyManager_ActionDoesNotServeAccount', '0xa1844eb2', 'manager', [['account', 'address'], ['action', 'address']]),
  row('PolicyManager_PlaceOutOfRange', '0x26013c4a', 'manager', [['place', 'uint256'], ['count', 'uint256']]),
  row('PolicyManager_NoSetup', '0x912e69d3', 'manager', [['account', 'address'], ['action', 'address']]),
  row('PolicyManager_NoActiveAttempt', '0x4c3e406c', 'manager', [['account', 'address'], ['action', 'address']]),
  row('PolicyManager_AttemptAlreadyActive', '0x2299285b', 'manager', [
    ['account', 'address'],
    ['action', 'address'],
    ['attemptId', 'uint64'],
  ]),
  row('PolicyManager_WrongAttemptId', '0x62a0f2aa', 'manager', [['supplied', 'uint64'], ['expected', 'uint64']]),
  row('PolicyManager_SetupCommitmentMismatch', '0x359cb009', 'manager', [['recomputed', 'bytes32'], ['committed', 'bytes32']]),
  row('PolicyManager_StaleAttempt', '0xbb175e1b', 'manager', [['judgedUnder', 'uint64'], ['currentNonce', 'uint64']]),
  row('PolicyManager_CredentialMismatch', '0x44cec67d', 'manager', [['place', 'uint256'], ['recomputed', 'bytes32']]),
  row('PolicyManager_PlacesNotStrictlyIncreasing', '0x98ed6faa', 'manager', [['place', 'uint256']]),
  row('PolicyManager_RequestExpired', '0x8a633487', 'manager', [['blockTimestamp', 'uint48'], ['validUntil', 'uint48']]),
  row('PolicyManager_ProofRejected', '0x0baf055d', 'manager', [['place', 'uint256'], ['method', 'address']]),
  row('PolicyManager_MethodStopped', '0xd8fb45f3', 'manager', [['place', 'uint256'], ['method', 'address']]),
  row('PolicyManager_MethodVetoedSpend', '0xd5bea339', 'manager', [['method', 'address']]),
  row('PolicyManager_MethodNotUsed', '0xb19e9abb', 'manager', [['attemptId', 'uint64'], ['method', 'address']]),
  row('PolicyManager_AttemptIgnoresPause', '0x52c83963', 'manager', [['attemptId', 'uint64']]),
  row('PolicyManager_MethodNotStopped', '0x9f427781', 'manager', [['method', 'address']]),
  row('PolicyManager_RuleUnsatisfied', '0x1318f9e6', 'manager', [['clause', 'uint256']]),
  row('PolicyManager_WaitNotOver', '0xc28b7bc4', 'manager', [['blockTimestamp', 'uint48'], ['consumableAfter', 'uint48']]),
  row('PolicyManager_WrongPayload', '0x567247d3', 'manager', [['supplied', 'bytes32'], ['committed', 'bytes32']]),
];

/** The action contract's six errors; the attempt state travels as the enum's `uint8`. */
export const ACTION_ROWS: readonly ErrorRow[] = [
  row('RecoveryAction_BatchNotApproved', '0x239f9939', 'action', [['callIndex', 'uint256']]),
  row('RecoveryAction_MalformedHandover', '0x35c2a352', 'action', [['payload', 'bytes']]),
  row('RecoveryAction_NotAKey', '0x63add869', 'action', [['authority', 'address']]),
  row('RecoveryAction_AlreadyPrivileged', '0xd2221b55', 'action', [['authority', 'address']]),
  row('RecoveryAction_NotConsumable', '0xeae434ed', 'action', [
    ['account', 'address'],
    ['state', 'uint8'],
    ['consumableAfter', 'uint48'],
    ['committedPayloadHash', 'bytes32'],
  ]),
  row('RecoveryAction_AccountNotServed', '0x3f6b40e3', 'action', [['account', 'address']]),
];

/** Finds a row by its declared name, failing the test when the fixture lacks it. */
export function rowNamed(name: string): ErrorRow {
  const found = [...MANAGER_ROWS, ...ACTION_ROWS].find((entry) => entry.name === name);

  if (found === undefined) throw new Error(`fixture lacks ${name}`);

  return found;
}

/** One argument as the encoder takes it. */
export type ArgumentValue = bigint | string;

/** The kit's twenty-eight declared errors. */
export const KIT_ROWS: readonly ErrorRow[] = [...MANAGER_ROWS, ...ACTION_ROWS];

/** The language pair's selectors, well known outside the kit. */
export const ERROR_STRING_SELECTOR: Hex = '0x08c379a0';
export const PANIC_SELECTOR: Hex = '0x4e487b71';

/** The canonical signature of a row, the text its selector hashes. */
export const signatureOf = (entry: { readonly name: string; readonly inputs: readonly { readonly type: string }[] }): string =>
  `${entry.name}(${entry.inputs.map((input) => input.type).join(',')})`;

const word = (seed: number, fill: string): string => fill.repeat(64 - 2) + seed.toString(16).padStart(2, '0');

/** A sample value per argument type, its lower-case address spelling exercising the checksum on the way out. */
export function sampleValue(type: string, seed: number): ArgumentValue {
  if (type === 'string') return `sample ${seed}`;

  if (type === 'address') return `0x${'ab'.repeat(19)}${seed.toString(16).padStart(2, '0')}`;

  if (type === 'bytes32') return `0x${word(seed, 'c')}`;

  if (type === 'bytes') return `0xdeadbeef${seed.toString(16).padStart(2, '0')}`;

  if (type === 'uint8') return BigInt(seed % 4);

  const bits = Number(type.slice('uint'.length));

  return (1n << BigInt(bits)) - 1n - BigInt(seed);
}

/** The value `decodeRevert` must hand back for a sample: integers as bigint, addresses checksummed, bytes lower case. */
export function expectedValue(type: string, value: ArgumentValue): KitErrorValue {
  if (type === 'address') return getAddress(value as Hex);

  if (typeof value === 'string') return type === 'string' ? value : value.toLowerCase();

  return value;
}

/** The revert data the chain would return for a row and its values, encoded with viem from the pinned row alone. */
export function revertData(entry: ErrorRow, values: readonly ArgumentValue[]): Hex {
  const encoded = encodeAbiParameters(entry.inputs as readonly AbiParameter[], values);

  return `${entry.selector}${encoded.slice(2)}`;
}

/** Sample values for every argument of a row, one seed per row. */
export const samplesFor = (entry: ErrorRow, seed: number): ArgumentValue[] =>
  entry.inputs.map((input, index) => sampleValue(input.type, seed + index));

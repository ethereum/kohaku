import { MIMC_MERKLE_TREE_LEVELS } from '@kohaku-eth/mimc-tree';

import type { PublicRootState } from '../store';

type Check = (value: unknown) => boolean;
const uint: Check = value => typeof value === 'string' && /^(?:0x[\da-f]+|\d+)$/i.test(value);
const integer: Check = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nonnegative: Check = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const text: Check = value => typeof value === 'string';
const boolean: Check = value => typeof value === 'boolean';
const optional = (check: Check): Check => value => value === undefined || check(value);
const array = (check: Check): Check => value => Array.isArray(value) && value.every(check);
const record = (fields: Record<string, Check>): Check => value =>
  typeof value === 'object' && value !== null && !Array.isArray(value) &&
  Object.entries(fields).every(([key, check]) => check((value as Record<string, unknown>)[key]));
const tuples = (keyCheck: Check, valueCheck: Check, keyField?: string): Check => value => {
  if (!Array.isArray(value)) return false;

  const keys = new Set<string>();

  return value.every(tuple => {
    if (!Array.isArray(tuple) || tuple.length !== 2 || !keyCheck(tuple[0]) || !valueCheck(tuple[1])) return false;

    if (keyField && BigInt(tuple[0]) !== BigInt(tuple[1][keyField])) return false;

    const key = keyCheck === uint ? BigInt(tuple[0]).toString() : tuple[0];

    if (keys.has(key)) return false;

    keys.add(key);

    return true;
  });
};

const event = { pool: uint, blockNumber: uint, transactionHash: uint };
const deposit = record({ ...event, commitment: uint, timestamp: uint,
  leafIndex: value => integer(value) && (value as number) < 2 ** 32 });
const withdrawal = record({ ...event, to: uint, nullifierHash: uint, relayer: uint, fee: uint });
const pool = record({ address: uint, asset: uint, isERC20: boolean, denomination: uint,
  protocolFeePercentage: nonnegative, registeredBlock: uint, rootHistorySize: integer,
  state: value => value === 0 || value === 1, extended: optional(boolean), lastSyncedBlock: optional(uint),
  finalizedBlock: optional(uint), verifiedRoot: optional(uint),
  frontier: optional(record({ size: integer, root: uint,
    nodes: value => array(uint)(value) && (value as unknown[]).length === MIMC_MERKLE_TREE_LEVELS })) });
const asset = record({ address: uint, name: text, symbol: text, decimals: integer });
const relayer = record({ ensName: text, hostname: text, relayerAddress: uint, stakeBalance: uint });
const secret = record({ commitment: uint, nullifierHash: uint, nullifier: uint, salt: uint });
const snapshot = record({
  deposits: record({ depositsTuples: tuples(uint, tuples(uint, deposit)) }),
  withdrawals: record({ withdrawalsTuples: tuples(uint, withdrawal, 'nullifierHash') }),
  pools: record({ poolsTuples: tuples(uint, pool, 'address') }),
  assets: record({ assetsTuples: tuples(uint, asset, 'address') }),
  relayers: record({ relayersTuples: tuples(text, relayer) }),
  sync: record({ lastSyncedBlock: uint, relayerRegistrySyncedBlock: optional(uint) }),
  legacySecrets: optional(record({ byPool: tuples(uint, array(secret)) })),
  signatureNonces: optional(record({ nextNonce: integer })),
});

/** Validate once at load, preserving imported notes and signature nonce reservations. */
export function validateSnapshot(value: unknown): PublicRootState {
  if (!snapshot(value)) throw new Error('Malformed Tornado Cash snapshot');

  const state = value as PublicRootState;

  for (const [address, deposits] of state.deposits.depositsTuples) {
    const indices = new Set<number>();

    for (const [commitment, entry] of deposits) {
      if (BigInt(entry.pool) !== BigInt(address) || BigInt(entry.commitment) !== BigInt(commitment) || indices.has(entry.leafIndex)) {
        throw new Error('Malformed Tornado Cash deposit entries');
      }

      indices.add(entry.leafIndex);
    }
  }

  // Derived secrets and protocol/fee configuration come from this session.
  const { deposits, withdrawals, pools, assets, relayers, sync, legacySecrets, signatureNonces } = state;

  return { deposits, withdrawals, pools, assets, relayers, sync,
    ...(legacySecrets === undefined ? {} : { legacySecrets }),
    ...(signatureNonces === undefined ? {} : { signatureNonces }) } as PublicRootState;
}

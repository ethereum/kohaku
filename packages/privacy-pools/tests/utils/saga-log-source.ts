import { Client, HttpStore, type CanonicalEvent } from '@saga-sync/client';
import type { TxLog } from '@kohaku-eth/provider';
import { decodeEventLog, encodeAbiParameters, parseAbi, toEventSelector, toHex } from 'viem';

import type { GetLogsParams } from '../../src/data/eth-client';

type LogsFn = (params: GetLogsParams) => Promise<TxLog[]>;

export interface SagaLogSourceParams {
  /** Base URL of the saga-sync manifest/CDN (HttpStore source). */
  sourceUrl: string;
  chainId: number;
  /**
   * The fork's pinned block number. saga tracks live, so its head can run past a
   * pinned fork — every result (saga stream and RPC tail) is truncated to this
   * block so hydrated state can never diverge from the fork's chain.
   */
  headBlock: bigint;
  /** RPC fallback for addresses not published by saga (e.g. the entrypoint) and for the tail past saga coverage. */
  fallback: LogsFn;
  /** Optional Ed25519 public key to verify the manifest signature. */
  publicKey?: string;
}

// saga publishes Deposited/Withdrawn/Ragequit but not LeafInserted — yet the pool
// Merkle tree is built solely from LeafInserted. Every deposit and every
// withdrawal inserts exactly one leaf (ragequit inserts none): the leaf is the
// deposit's `_commitment` / the withdrawal's `_newCommitment`, in (block, logIndex)
// order. So we reconstruct LeafInserted from the published events and hand the
// existing sync a complete, correctly-ordered leaf stream.
const leafAbi = parseAbi([
  'event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitment)',
  'event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)',
]);
const LEAF_INSERTED_TOPIC = toEventSelector('event LeafInserted(uint256 _index, uint256 _leaf, uint256 _root)');

const toTxLog = (ev: CanonicalEvent): TxLog => ({
  address: ev.contractAddress,
  data: ev.data,
  topics: ev.topics,
  blockNumber: BigInt(ev.blockNumber),
});

// The leaf commitment inserted by an event, or null if it inserts none (ragequit).
function insertedLeaf(ev: CanonicalEvent): bigint | null {
  try {
    const decoded = decodeEventLog({ abi: leafAbi, topics: ev.topics as [`0x${string}`, ...`0x${string}`[]], data: ev.data });

    if (decoded.eventName === 'Deposited') return decoded.args._commitment;

    if (decoded.eventName === 'Withdrawn') return decoded.args._newCommitment;
  } catch {
    // Not a Deposited/Withdrawn event (e.g. Ragequit) — no leaf.
  }

  return null;
}

function synthLeafInsertedLog(pool: string, index: bigint, leaf: bigint, blockNumber: bigint): TxLog {
  return {
    address: pool,
    topics: [LEAF_INSERTED_TOPIC],
    // LeafInserted(uint256 _index, uint256 _leaf, uint256 _root); _root is unused by tree building.
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [index, leaf, 0n],
    ),
    blockNumber,
  };
}

export async function createSagaLogSource({
  sourceUrl,
  chainId,
  headBlock,
  fallback,
  publicKey,
}: SagaLogSourceParams): Promise<LogsFn> {
  const client = new Client({ source: new HttpStore(sourceUrl), publicKey });
  const manifest = await client.fetchManifest();
  const chainIdHex = toHex(chainId);

  return async (params: GetLogsParams): Promise<TxLog[]> => {
    const address = params.address as `0x${string}`;

    let protocolId: string;

    try {
      protocolId = await client.resolveProtocolId({ address, chainId: chainIdHex });
    } catch {
      // Not published by saga (e.g. the entrypoint) — serve from RPC. The fork is
      // authoritative and can't return past its own head, so it isn't clamped.
      return fallback(params);
    }

    const sagaLast = manifest.lastCoveredBlock(protocolId);

    if (sagaLast === null) return fallback(params);

    // saga tracks live: never read past its coverage nor past the fork's pinned
    // head (guards against saga's producer advancing beyond the fork).
    const sagaCap = sagaLast < headBlock ? sagaLast : headBlock;
    const reqTo = params.toBlock;
    const sagaTo = reqTo !== undefined && reqTo < sagaCap ? reqTo : sagaCap;

    // Reconstruct the full pool history (leaf indices are global, so always
    // stream from the start — the sync merges by index, so this is idempotent).
    const logs: TxLog[] = [];
    let leafIndex = 1n; // on-chain LeafInserted is 1-based.

    for await (const ev of client.streamEvents(protocolId, { fromBlock: 0n, toBlock: sagaTo + 1n })) {
      logs.push(toTxLog(ev));

      const leaf = insertedLeaf(ev);

      if (leaf !== null) {
        logs.push(synthLeafInsertedLog(address, leafIndex, leaf, BigInt(ev.blockNumber)));
        leafIndex += 1n;
      }
    }

    // saga's head is behind the request/fork — sync the (sagaLast, …] tail over
    // RPC, which carries the real (correctly-indexed) LeafInserted events.
    if (reqTo === undefined || reqTo > sagaLast) {
      logs.push(...(await fallback({ ...params, fromBlock: sagaLast + 1n })));
    }

    return logs;
  };
}

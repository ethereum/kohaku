import { Client, HttpStore } from '@saga-sync/client';
import { createPublicClient, decodeEventLog, http, parseAbi, type PublicClient } from 'viem';
import { beforeAll, describe, expect, inject, it } from 'vitest';

import { computeMerkleTreeRoot } from '../../../src/utils/proof.util';
import { getChainConfigSetup } from '../../constants';

// Validates the core saga claim: the pool Merkle tree is fully reconstructable
// from saga's published Deposited/Withdrawn events (ragequit inserts no leaf).
// Pick a cutoff at saga's coverage, rebuild the tree from deposits+withdrawals in
// (block, logIndex) order, and assert its root equals the pool's on-chain root at
// that block. Reads mainnet directly (archive) — no anvil/deposit machinery.
const SAGA_SYNC_URL = process['env']['SAGA_SYNC_URL'];
const chainId = inject('chainId');

const POOLS = [
  { protocol: 'privacy-pools-1-eth', address: '0xF241d57C6DebAe225c0F2e6eA1529373C9A9C9fB' as const },
  { protocol: 'privacy-pools-1-usdt', address: '0xe859C0bD25f260BaEE534Fb52e307D3b64D24572' as const },
  { protocol: 'privacy-pools-1-usdc', address: '0xb419c2867aB3CBc78921660cB95150d95A94ce86' as const },
];

const eventAbi = parseAbi([
  'event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitment)',
  'event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)',
]);
const poolAbi = parseAbi(['function currentRoot() view returns (uint256)']);

describe.skipIf(chainId !== 1 || !SAGA_SYNC_URL)('saga reconstruction — tree root matches chain', () => {
  let saga: Client;
  let manifest: Awaited<ReturnType<Client['fetchManifest']>>;
  let rpc: PublicClient;
  let headBlock: bigint;

  beforeAll(async () => {
    saga = new Client({ source: new HttpStore(SAGA_SYNC_URL!) });
    manifest = await saga.fetchManifest();
    rpc = createPublicClient({ transport: http(getChainConfigSetup(1).rpcUrl) });
    headBlock = await rpc.getBlockNumber();
  });

  it.each(POOLS)('rebuilds $protocol from deposits+withdrawals matching on-chain root', async ({ protocol, address }) => {
    const sagaLast = manifest.lastCoveredBlock(protocol);

    expect(sagaLast).not.toBeNull();

    const cutoff = sagaLast! < headBlock ? sagaLast! : headBlock;

    const leaves: { block: bigint; logIndex: bigint; commitment: bigint }[] = [];

    for await (const ev of saga.streamEvents(protocol, { fromBlock: 0n, toBlock: cutoff + 1n })) {
      try {
        const decoded = decodeEventLog({ abi: eventAbi, topics: ev.topics as [`0x${string}`, ...`0x${string}`[]], data: ev.data });
        const commitment = decoded.eventName === 'Deposited' ? decoded.args._commitment : decoded.args._newCommitment;

        leaves.push({ block: BigInt(ev.blockNumber), logIndex: BigInt(ev.logIndex), commitment });
      } catch {
        // Ragequit or other non-leaf event — skip.
      }
    }

    leaves.sort((a, b) => (a.block === b.block ? Number(a.logIndex - b.logIndex) : Number(a.block - b.block)));

    const localRoot = computeMerkleTreeRoot(leaves.map((l) => l.commitment));
    const onchainRoot = await rpc.readContract({ address, abi: poolAbi, functionName: 'currentRoot', blockNumber: cutoff });

    expect(leaves.length).toBeGreaterThan(0);
    expect(localRoot).toBe(onchainRoot);
  }, 180_000);
});

import type { EthereumProvider, TxLog } from '@kohaku-eth/provider';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, parseAbiParameters, type Hex } from 'viem';
import { TacitConfigs } from '../../src';
import { hex } from '../../src/crypto/bytes';
import { decodeTransact, POOL_ABI, TRANSACT_TOPIC } from '../../src/pool/abi';
import { incTree } from '../../src/pool/tree';
import type { SealedNote } from '../../src/pool/memo';

const ZERO = '0x0000000000000000000000000000000000000000';
const word = (x: bigint): Hex => `0x${x.toString(16).padStart(64, '0')}`;

/**
 * An in-memory stand-in for the pool: it records `Transact` events, keeps the roots it has held with their leaf
 * counts (what `rootSize` answers), and serves both through a minimal provider.
 */
export class ModelPool {
  readonly config = TacitConfigs[1]!;
  readonly logs: TxLog[] = [];
  readonly tree = incTree();
  readonly sizes = new Map<string, number>([[this.tree.root.toString(), 0]]);
  tip = 1000;
  logCalls: Array<[number, number]> = [];
  /** A window wider than this many blocks is refused the way a node with a range limit refuses it. */
  maxWindow = Infinity;
  /** Blocks whose logs a lagging node does not return. */
  hidden = new Set<number>();
  /** Runs before each `head()` answer, for a block that lands between a read and the head check. */
  beforeHead: (() => void) | null = null;

  /** Records a transaction at `block`; `outs` are the two output notes (null: nothing inserted for that slot). */
  add(args: { block: number; nf?: [bigint, bigint]; outs: [SealedNote | null, SealedNote | null] }): void {
    const nf = args.nf ?? [BigInt(this.logs.length * 2 + 11), BigInt(this.logs.length * 2 + 12)];
    const leaf = args.outs.map((o) => o?.leaf ?? 0n) as [bigint, bigint];
    const inserts = leaf[0] !== 0n || leaf[1] !== 0n;
    const firstIndex = this.tree.size;

    if (inserts) {
      this.tree.append(leaf);
      this.sizes.set(this.tree.root.toString(), this.tree.size);
    }

    const topics = [TRANSACT_TOPIC, word(nf[0]), word(nf[1])];
    const data = encodeAbiParameters(
      parseAbiParameters('bytes32, bytes32, uint256, bytes32, address, int256, address, uint256, bytes, bytes'),
      [word(leaf[0]), word(leaf[1]), BigInt(firstIndex), word(this.tree.root), ZERO, 0n, ZERO, 0n, hex(args.outs[0]?.memo ?? new Uint8Array()), hex(args.outs[1]?.memo ?? new Uint8Array())],
    );

    this.logs.push({ blockNumber: BigInt(args.block), topics: [...topics], data, address: this.config.pool, logIndex: this.logs.length });
  }

  provider(): EthereumProvider {
    const provider: Pick<EthereumProvider, 'getChainId' | 'getBlockNumber' | 'getLogs' | 'call'> & { _internal: undefined } = {
      _internal: undefined,
      getChainId: async () => 1n,
      getBlockNumber: async () => BigInt(this.tip),
      getLogs: async (params: { fromBlock?: unknown; toBlock?: unknown }) => {
        const from = Number(params.fromBlock);
        const to = Number(params.toBlock);

        this.logCalls.push([from, to]);

        if (to - from + 1 > this.maxWindow) throw new Error(`query exceeds max block range ${this.maxWindow} blocks`);

        return this.logs.filter((l) => l.blockNumber >= BigInt(from) && l.blockNumber <= BigInt(to) && !this.hidden.has(Number(l.blockNumber)));
      },
      call: async (call: { input?: Hex }) => {
        const { functionName, args } = decodeFunctionData({ abi: POOL_ABI, data: call.input as Hex });

        if (functionName === 'head') {
          this.beforeHead?.();

          return encodeAbiParameters(parseAbiParameters('bytes32, uint256'), [word(this.tree.root), BigInt(this.tree.size)]);
        }

        const size = this.sizes.get(BigInt(args![0] as Hex).toString());

        if (size === undefined) throw new Error('UnknownMembershipRoot()');

        return encodeFunctionResult({ abi: POOL_ABI, functionName: 'rootSize', result: BigInt(size) });
      },
    };

    return provider as unknown as EthereumProvider;
  }

  /** The relayer's `/events` page for blocks `from` on: what its feed would serve for these logs. */
  feedPage(from: number) {
    const events = this.logs
      .filter((log) => log.blockNumber >= BigInt(from) && log.blockNumber <= BigInt(this.tip))
      .map((log) => {
        const e = decodeTransact(log);

        return {
          kind: 'transact',
          nf0: e.nf[0].toString(),
          nf1: e.nf[1].toString(),
          outLeaf0: e.outLeaf[0].toString(),
          outLeaf1: e.outLeaf[1].toString(),
          firstIndex: e.firstIndex,
          memo0: hex(e.memo[0]),
          memo1: hex(e.memo[1]),
          block: e.block,
        };
      });

    return { chainId: this.config.chainId, pool: this.config.pool, from, through: this.tip, events };
  }

  /** The topic every log carries, for tests that build logs by hand. */
  static readonly topic = TRANSACT_TOPIC;
}

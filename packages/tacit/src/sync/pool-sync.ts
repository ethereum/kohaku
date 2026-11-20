import { type Storage } from "@kohaku-eth/plugins";
import { type EthereumProvider } from "@kohaku-eth/provider";
import { type TacitChainConfig } from "../config";
import { type PoolKeys } from "../crypto/address";
import { decodeTransact, TRANSACT_TOPIC } from "../pool/abi";
import { type IncTree } from "../pool/tree";
import { type TacitRelayerClient } from "../relayer/client";
import { sleep } from "../sleep";
import { absorb, OutOfOrderError, stateFromSaved, type OwnedNote, type SyncState } from "./absorb";
import { byPosition, feedEvents } from "./feed";
import { readLogs } from "./logs";
import { checkBatch, reachesHead } from "./pool-chain";
import { StateStore } from "./store";

export type SyncDeps = {
  provider: EthereumProvider;
  storage: Storage;
  config: TacitChainConfig;
  keys: PoolKeys;
  asset: bigint;
  /** Where confirmed history is read first, when there is a relayer. */
  relayer?: TacitRelayerClient;
  /** The key the synced state is kept under. */
  storageKey: string;
  /** How long to wait before reading again when the history does not reach the pool's head. Default 1,500 ms. */
  retryMs?: number;
};

/**
 * Follows the pool: its leaves in an incremental tree, this wallet's notes among them, and which of them are
 * spent. Confirmed history is persisted; the few newest blocks are read again each time. Every batch is checked
 * against the pool (`rootSize`) before it is kept, so neither a node's logs nor a relayer's feed can forge a leaf.
 */
export class PoolSync {
  private saved: SyncState | null = null;
  private view: SyncState | null = null;
  private running: Promise<unknown> = Promise.resolve();
  private useFeed = true;
  private healedAt = 0;
  private readonly store: StateStore;

  constructor(private readonly deps: SyncDeps) {
    this.store = new StateStore(deps.storage, deps.storageKey);
  }

  /** Reads what is new. One read at a time: each builds on the state the last left. */
  sync(): Promise<void> {
    const run = this.running.catch(() => undefined).then(() => this.readHealed());

    this.running = run;

    return run;
  }

  /** Forgets the saved state and reads the chain's logs from the pool's first block, without the relayer's feed. */
  async rescan(): Promise<void> {
    await this.running.catch(() => undefined);

    this.saved = stateFromSaved(null, this.deps.keys, this.deps.config.deployBlock);
    this.view = null;
    this.useFeed = false;

    try {
      await this.sync();
    } finally {
      this.useFeed = true;
    }
  }

  private get state(): SyncState {
    const state = this.view ?? this.saved;

    if (!state) throw new Error("tacit: sync has not run");

    return state;
  }

  get tree(): IncTree {
    return this.state.tree;
  }

  get notes(): OwnedNote[] {
    return this.state.notes;
  }

  private async load(): Promise<SyncState> {
    this.saved ??= stateFromSaved(await this.store.load(), this.deps.keys, this.deps.config.deployBlock);

    return this.saved;
  }

  private async keep(state: SyncState): Promise<void> {
    this.saved = state;

    await this.store.save(state);
  }

  private async verified(next: SyncState, before: SyncState): Promise<SyncState> {
    await checkBatch(this.deps.provider, this.deps.config.pool, next.tree, before.tree);

    return next;
  }

  private async fromFeed(safe: number): Promise<void> {
    const { relayer, config, keys, asset } = this.deps;

    for (let page = 0; relayer && page < 10_000; page++) {
      const base = await this.load();
      const from = base.block + 1;

      if (from > safe) return;

      const feed = await feedEvents(relayer, config, from, safe);

      if (!feed) return;

      const next = await this.verified({ ...absorb(base, feed.events, { keys, asset }), block: feed.through }, base);

      await this.keep(next);
    }
  }

  // A node that answered short of the range it was asked can leave the kept history missing leaves, so every later
  // read stops at a leaf out of order, or ends short of the pool's head. The chain's logs alone are then read again from
  // the pool's first block, at most once in ten minutes.
  private async readHealed(): Promise<void> {
    try {
      await this.read();
    } catch (error) {
      if (!(error instanceof OutOfOrderError) || Date.now() - this.healedAt < 600_000) throw error;

      this.healedAt = Date.now();
      this.saved = stateFromSaved(null, this.deps.keys, this.deps.config.deployBlock);
      this.view = null;
      this.useFeed = false;

      try {
        await this.read();
      } finally {
        this.useFeed = true;
      }
    }
  }

  // One read, then a check that it reaches the pool's head. A node a block behind, or a block that landed meanwhile,
  // is read again; a history that still falls short is treated as a gap and healed.
  private async read(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      let failure: OutOfOrderError;

      try {
        await this.readOnce();

        if (await reachesHead(this.deps.provider, this.deps.config.pool, this.state.tree)) return;

        failure = new OutOfOrderError("tacit: the history read ends short of the pool's head; call rescan() to rebuild it");
      } catch (error) {
        if (!(error instanceof OutOfOrderError)) throw error;

        failure = error;
      }

      if (attempt >= 2) throw failure;

      await sleep(this.deps.retryMs ?? 1500);
    }
  }

  private async readOnce(): Promise<void> {
    const { provider, config, keys, asset } = this.deps;
    const tip = Number(await provider.getBlockNumber());
    const safe = tip - config.confirmations;
    let base = await this.load();

    if (this.useFeed && this.deps.relayer && base.block < safe) {
      await this.fromFeed(safe).catch(() => undefined);
      base = await this.load();
    }

    const from = base.block + 1;

    if (from > tip) return;

    const logs = await readLogs(provider, { address: config.pool, topic0: TRANSACT_TOPIC, from, to: tip, chunk: config.logChunk ?? 5000 });
    const events = logs.map(decodeTransact).sort(byPosition);

    if (safe >= from) {
      const confirmed = events.filter((e) => e.block <= safe);
      const next = await this.verified({ ...absorb(base, confirmed, { keys, asset }), block: safe }, base);

      await this.keep(next);
      base = next;
    }

    this.view = absorb(base, events.filter((e) => e.block > safe), { keys, asset });
  }
}

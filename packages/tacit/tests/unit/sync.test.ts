import { MemoryStorage } from '@kohaku-eth/plugins';
import { describe, expect, it } from 'vitest';
import { keysFromIdentity } from '../../src/crypto/address';
import { unhex } from '../../src/crypto/bytes';
import { decodeTransact, TRANSACT_TOPIC } from '../../src/pool/abi';
import { sealNote } from '../../src/pool/memo';
import { poolAsset } from '../../src/pool/witness';
import { absorb, stateFromSaved } from '../../src/sync/absorb';
import { logFailure, readLogs } from '../../src/sync/logs';
import { PoolSync } from '../../src/sync/pool-sync';
import { stateKey } from '../../src/sync/store';
import { ModelPool } from '../utils/model-pool';

const keys = keysFromIdentity(unhex('0x' + '11'.repeat(32)));
const other = keysFromIdentity(unhex('0x' + '22'.repeat(32)));
const model = () => new ModelPool();
const assetOf = (pool: ModelPool) => poolAsset({ chainId: pool.config.chainId, pool: pool.config.pool });

describe('logFailure', () => {
  it('narrows to the limit a node names, or by a quarter when it only mentions ranges', () => {
    expect(logFailure(new Error('query exceeds max block range 100 blocks'), 5000)).toEqual({ step: 100 });
    expect(logFailure(new Error('ranges over 10,000 blocks are not supported'), 50_000)).toEqual({ step: 10_000 });
    expect(logFailure(new Error('block range too large'), 5000)).toEqual({ step: 1250 });
    expect(logFailure(new Error('block range too large'), 1)).toBeNull();
  });

  it('waits when a node is rate limited and gives up on anything else', () => {
    expect(logFailure(new Error('429 Too Many Requests'), 5000)).toEqual({ busy: true });
    expect(logFailure(new Error('connection reset'), 5000)).toBeNull();
  });
});

describe('readLogs', () => {
  const read = (pool: ModelPool, chunk: number, from = 1, to = 1000) =>
    readLogs(pool.provider(), { address: pool.config.pool, topic0: TRANSACT_TOPIC, from, to, chunk });

  it('reads the whole range in windows and keeps only the pool\'s Transact logs', async () => {
    const pool = model();

    pool.add({ block: 5, outs: [sealNote(keys, 1n, assetOf(pool)), null] });
    pool.add({ block: 950, outs: [sealNote(keys, 2n, assetOf(pool)), null] });
    pool.logs.push({ ...pool.logs[0]!, topics: ['0x' + '00'.repeat(32)] });
    pool.logs.push({ ...pool.logs[0]!, address: '0x0000000000000000000000000000000000000001' });

    expect(await read(pool, 400)).toHaveLength(2);
    expect(pool.logCalls).toEqual([[1, 400], [401, 800], [801, 1000]]);
  });

  it('narrows its window when a node refuses a range', async () => {
    const pool = model();

    pool.maxWindow = 250;
    pool.add({ block: 600, outs: [sealNote(keys, 1n, assetOf(pool)), null] });

    expect(await read(pool, 5000)).toHaveLength(1);
    expect(pool.logCalls.at(-1)![1] - pool.logCalls.at(-1)![0] + 1).toBeLessThanOrEqual(250);
  });

  it('throws an error it does not recognise', async () => {
    const provider = { ...model().provider(), getLogs: async () => { throw new Error('connection reset'); } };

    await expect(readLogs(provider, { address: model().config.pool, topic0: TRANSACT_TOPIC, from: 1, to: 10, chunk: 5 })).rejects.toThrow('connection reset');
  });
});

describe('absorb', () => {
  const setup = () => {
    const pool = model();
    const asset = assetOf(pool);

    return { pool, asset, ctx: { keys, asset }, empty: () => stateFromSaved(null, keys, 1) };
  };

  it('finds the notes addressed to the wallet and tracks their paths', () => {
    const { pool, asset, ctx, empty } = setup();

    pool.add({ block: 10, outs: [sealNote(keys, 1000n, asset), sealNote(other, 55n, asset)] });
    pool.add({ block: 11, outs: [sealNote(other, 7n, asset), sealNote(keys, 250n, asset)] });

    const state = absorb(empty(), pool.logs.map(decodeTransact), ctx);

    expect(state.notes.map((n) => [n.index, n.v])).toEqual([[0, '1000'], [3, '250']]);
    expect(state.tree.size).toBe(4);
    expect(state.tree.root).toBe(pool.tree.root);
    expect([0, 3].every((i) => state.tree.has(i))).toBe(true);
    expect([1, 2].some((i) => state.tree.has(i))).toBe(false);
  });

  it('drops a note once its nullifier appears, and ignores zero-value notes', () => {
    const { pool, asset, ctx, empty } = setup();

    pool.add({ block: 10, outs: [sealNote(keys, 1000n, asset), sealNote(keys, 0n, asset)] });

    const first = absorb(empty(), pool.logs.map(decodeTransact), ctx);

    expect(first.notes).toHaveLength(1);

    pool.add({ block: 11, nf: [first.notes[0]!.nf, 9n], outs: [sealNote(keys, 600n, asset), null] });

    const second = absorb(first, pool.logs.slice(1).map(decodeTransact), ctx);

    expect(second.notes.map((n) => n.v)).toEqual(['600']);
    expect(second.tree.has(0)).toBe(false);
    expect(first.notes).toHaveLength(1);
  });

  it('refuses a history with a gap or out of order', () => {
    const { pool, asset, ctx, empty } = setup();

    pool.add({ block: 10, outs: [sealNote(keys, 1n, asset), null] });
    pool.add({ block: 11, outs: [sealNote(keys, 2n, asset), null] });

    expect(() => absorb(empty(), pool.logs.slice(1).map(decodeTransact), ctx)).toThrow(/out of order/);
  });

  it('sees a transaction that inserts nothing only as spent nullifiers', () => {
    const { pool, asset, ctx, empty } = setup();

    pool.add({ block: 10, outs: [sealNote(keys, 1000n, asset), null] });

    const first = absorb(empty(), pool.logs.map(decodeTransact), ctx);

    pool.add({ block: 11, nf: [first.notes[0]!.nf, 0n], outs: [null, null] });

    const second = absorb(first, pool.logs.slice(1).map(decodeTransact), ctx);

    expect(second.notes).toHaveLength(0);
    expect(second.tree.size).toBe(2);
  });
});

describe('PoolSync', () => {
  const build = (pool: ModelPool, storage = new MemoryStorage(), relayer?: ConstructorParameters<typeof PoolSync>[0]['relayer']) => {
    const config = { ...pool.config, confirmations: 12, deployBlock: 1 };

    return {
      storage,
      sync: new PoolSync({ provider: pool.provider(), storage, config, keys, asset: assetOf(pool), relayer, storageKey: stateKey(config, keys.address), retryMs: 0 }),
      key: stateKey(config, keys.address),
    };
  };

  const fill = (pool: ModelPool) => {
    const asset = assetOf(pool);

    pool.add({ block: 100, outs: [sealNote(keys, 1000n, asset), sealNote(other, 5n, asset)] });
    pool.add({ block: 200, outs: [sealNote(other, 6n, asset), sealNote(keys, 400n, asset)] });
  };

  it('reads confirmed history, persists it, and resumes from where it stopped', async () => {
    const pool = model();

    fill(pool);

    const { sync, storage, key } = build(pool);

    await sync.sync();
    expect(sync.notes.map((n) => n.v)).toEqual(['1000', '400']);

    const saved = JSON.parse((await storage.get(key))!);

    expect(saved.block).toBe(988);
    expect(saved.notes).toHaveLength(2);
    expect(JSON.stringify(saved)).not.toMatch(/"(sk|nk)"/);

    pool.logCalls = [];

    const again = build(pool, storage);

    await again.sync.sync();
    expect(again.sync.notes.map((n) => n.v)).toEqual(['1000', '400']);
    expect(pool.logCalls[0]![0]).toBe(989);
  });

  it('shows the newest blocks but persists only what is confirmed', async () => {
    const pool = model();

    fill(pool);
    pool.add({ block: 995, outs: [sealNote(keys, 77n, assetOf(pool)), null] });

    const { sync, storage, key } = build(pool);

    await sync.sync();
    expect(sync.notes.map((n) => n.v)).toEqual(['1000', '400', '77']);
    expect(JSON.parse((await storage.get(key))!).notes).toHaveLength(2);

    pool.tip = 1100;
    await sync.sync();
    expect(JSON.parse((await storage.get(key))!).notes).toHaveLength(3);
  });

  it('refuses leaves that are not the ones the pool holds', async () => {
    const pool = model();

    fill(pool);
    pool.sizes.set(pool.tree.root.toString(), 99);

    await expect(build(pool).sync.sync()).rejects.toThrow(/does not match the pool/);
  });

  it('reads through a window the node limits', async () => {
    const pool = model();

    fill(pool);
    pool.maxWindow = 150;

    const { sync } = build(pool);

    await sync.sync();
    expect(sync.notes).toHaveLength(2);
  });

  it('reports a history that ends short of the pool, and a rescan rebuilds it once the node recovers', async () => {
    const pool = model();

    fill(pool);
    pool.hidden.add(200);

    const { sync } = build(pool);

    await expect(sync.sync()).rejects.toThrow(/ends short of the pool's head.*rescan/);

    pool.hidden.clear();
    await sync.rescan();
    expect(sync.notes.map((n) => n.v)).toEqual(['1000', '400']);
  });

  it('leaves its kept history alone when only the newest blocks have a gap', async () => {
    const pool = model();
    const asset = assetOf(pool);

    fill(pool);
    pool.add({ block: 995, outs: [sealNote(keys, 77n, asset), null] });
    pool.add({ block: 996, outs: [sealNote(keys, 88n, asset), null] });
    pool.hidden.add(995);

    const { sync, storage, key } = build(pool);

    await expect(sync.sync()).rejects.toThrow(/out of order/);
    expect(JSON.parse((await storage.get(key))!).notes).toHaveLength(2);

    pool.hidden.clear();
    await sync.sync();
    expect(sync.notes.map((n) => n.v)).toEqual(['1000', '400', '77', '88']);
  });

  it('heals when a feed stops short of the block it claims to reach', async () => {
    const pool = model();
    const asset = assetOf(pool);

    fill(pool);
    pool.add({ block: 500, outs: [sealNote(keys, 777n, asset), null] });

    // The feed drops the block-500 transaction and still says it runs through the confirmed head.
    const short = {
      events: async (from: number) => {
        const page = pool.feedPage(from);

        page.events = page.events.filter((e) => e.block !== 500);

        return page;
      },
    } as unknown as ConstructorParameters<typeof PoolSync>[0]['relayer'];
    const { sync } = build(pool, new MemoryStorage(), short);

    await sync.sync();
    expect(sync.notes.map((n) => n.v)).toEqual(['1000', '400', '777']);
  });

  it('fails loudly, not quietly, when even a rebuild from the chain\'s logs leaves the history short of the pool', async () => {
    const pool = model();

    fill(pool);
    pool.hidden.add(200);

    await expect(build(pool).sync.sync()).rejects.toThrow(/ends short of the pool's head/);
  });

  it('reads again when a block lands between the read and the check', async () => {
    const pool = model();
    const asset = assetOf(pool);

    fill(pool);

    let landed = false;

    pool.beforeHead = () => {
      if (landed) return;

      landed = true;
      pool.tip = 1001;
      pool.add({ block: 1001, outs: [sealNote(keys, 5n, asset), null] });
    };

    const { sync } = build(pool);

    await sync.sync();
    expect(sync.notes.map((n) => n.v)).toEqual(['1000', '400', '5']);
  });

  it('serves concurrent syncs one at a time', async () => {
    const pool = model();

    fill(pool);

    const { sync } = build(pool);

    await Promise.all([sync.sync(), sync.sync(), sync.sync()]);
    expect(sync.notes).toHaveLength(2);
  });

  describe('with a relayer feed', () => {
    const feedOf = (pool: ModelPool, tamper?: (page: ReturnType<ModelPool['feedPage']>) => void) =>
      ({
        events: async (from: number) => {
          const page = pool.feedPage(from);

          tamper?.(page);

          return page;
        },
      }) as unknown as ConstructorParameters<typeof PoolSync>[0]['relayer'];

    it('takes confirmed history from the feed, and the rest from the chain', async () => {
      const pool = model();

      fill(pool);
      pool.add({ block: 995, outs: [sealNote(keys, 77n, assetOf(pool)), null] });
      pool.logCalls = [];

      const { sync } = build(pool, new MemoryStorage(), feedOf(pool));

      await sync.sync();
      expect(sync.notes.map((n) => n.v)).toEqual(['1000', '400', '77']);
      expect(pool.logCalls).toEqual([[989, 1000]]);
    });

    it('falls back to the chain when the feed lies, and a rescan ignores the feed', async () => {
      const pool = model();
      const asset = assetOf(pool);

      fill(pool);

      const forged = feedOf(pool, (page) => {
        page.events[0]!.outLeaf0 = '12345';
      });
      const { sync } = build(pool, new MemoryStorage(), forged);

      await sync.sync();
      expect(sync.notes.map((n) => n.v)).toEqual(['1000', '400']);

      pool.add({ block: 300, outs: [sealNote(keys, 9n, asset), null] });
      pool.logCalls = [];
      await sync.rescan();
      expect(sync.notes.map((n) => n.v)).toEqual(['1000', '400', '9']);
      expect(pool.logCalls[0]![0]).toBe(1);
    });

    it('refuses a feed for another pool', async () => {
      const pool = model();

      fill(pool);

      const wrong = feedOf(pool, (page) => {
        page.pool = '0x0000000000000000000000000000000000000001';
      });
      const { sync } = build(pool, new MemoryStorage(), wrong);

      await sync.sync();
      expect(sync.notes).toHaveLength(2);
    });
  });
});

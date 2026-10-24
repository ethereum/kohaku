import {
  InsufficientBalanceError,
  InvalidAddressError,
  MemoryStorage,
  UnsupportedAssetError,
  UnsupportedChainError,
  type ERC20AssetId,
  type Host,
} from '@kohaku-eth/plugins';
import { decodeFunctionData } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import {
  createTacitBroadcaster,
  createTacitPlugin,
  E_ADDRESS,
  TacitConfigs,
  TacitFeeError,
  TacitFragmentedBalanceError,
  type TacitPluginParameters,
  type TacitProver,
} from '../../src';
import { decodeAddress, keysFromIdentity } from '../../src/crypto/address';
import { unhex } from '../../src/crypto/bytes';
import { POOL_ABI, type TransactTx } from '../../src/pool/abi';
import { openNote, sealNote } from '../../src/pool/memo';
import { extDataHash, poolAsset, publicAmount } from '../../src/pool/witness';
import { ModelPool } from '../utils/model-pool';

const ETH: ERC20AssetId = { __type: 'erc20', contract: E_ADDRESS };
const ZERO = '0x0000000000000000000000000000000000000000';
const FRESH = '0x00000000000000000000000000000000000dead1';
const identityKey = ('0x' + '11'.repeat(32)) as `0x${string}`;
const aliceKeys = keysFromIdentity(unhex(identityKey));
const bobKeys = keysFromIdentity(unhex('0x' + '22'.repeat(32)));
const SELF = { ...TacitConfigs[1]!, relayerUrl: undefined, relayerAddress: undefined, confirmations: 12, deployBlock: 1 };
const RELAYER_URL = 'https://relayer.test/evm-pool/keeper';
const WITH_RELAYER = { ...SELF, relayerUrl: RELAYER_URL, relayerAddress: TacitConfigs[1]!.relayerAddress };

// A prover that proves nothing: it reports the public signals the witness implies, so the transaction the plugin
// builds can be checked against what the pool would recompute.
type CircuitInput = {
  root: string; oldRoot: string; newRoot: string; startIndex: string; publicAmount: string; extDataHash: string; asset: string;
  nf: string[]; outLeaf: string[]; inV: string[];
};

function mockProver() {
  const inputs: CircuitInput[] = [];
  const prover: TacitProver = {
    async prove(input) {
      const i = input as unknown as CircuitInput;

      inputs.push(i);

      return {
        proof: { pi_a: ['1', '2', '1'], pi_b: [['3', '4'], ['5', '6'], ['1', '0']], pi_c: ['7', '8', '1'] },
        publicSignals: [i.root, i.oldRoot, i.newRoot, i.startIndex, i.publicAmount, i.extDataHash, i.asset, ...i.nf, ...i.outLeaf],
      };
    },
  };

  return { prover, inputs };
}

function setup(args: { notes?: bigint[]; fetch?: Host['network']['fetch']; mnemonicPath?: string[] } = {}) {
  const pool = new ModelPool();
  const asset = poolAsset({ chainId: 1, pool: pool.config.pool });
  const deriveAt = vi.fn(async () => identityKey);
  const { prover, inputs } = mockProver();

  (args.notes ?? []).forEach((value, i) => pool.add({ block: 100 + i, outs: [sealNote(aliceKeys, value, asset), sealNote(bobKeys, 3n, asset)] }));

  const host: Host = {
    keystore: { deriveAt } as unknown as Host['keystore'],
    network: { fetch: args.fetch ?? (async () => new Response('{}', { status: 404 })) },
    storage: new MemoryStorage(),
    provider: pool.provider(),
  };
  const open = (params: TacitPluginParameters = {}) => createTacitPlugin(host, { config: SELF, identityKey, proverFactory: () => prover, ...params });

  return { pool, asset, host, deriveAt, prover, inputs, open };
}

// What the pool recomputes and compares before it accepts a proof.
function expectBound(tx: TransactTx, asset: bigint) {
  const hash = extDataHash({
    chainId: 1, pool: SELF.pool, recipient: tx.recipient, extAmount: BigInt(tx.extAmount), relayer: tx.relayer, fee: BigInt(tx.fee),
    memo0: unhex(tx.memo0), memo1: unhex(tx.memo1),
  });

  expect(BigInt(tx.publicInputs[5]!)).toBe(hash);
  expect(BigInt(tx.publicInputs[4]!)).toBe(publicAmount(BigInt(tx.extAmount), BigInt(tx.fee)));
  expect(BigInt(tx.publicInputs[6]!)).toBe(asset);
}

const decode = (data: string) => decodeFunctionData({ abi: POOL_ABI, data: data as `0x${string}` });

describe('createTacitPlugin', () => {
  it('derives its identity from the keystore at the plugin\'s own path', async () => {
    const { host, deriveAt } = setup();

    await createTacitPlugin(host, { config: SELF, proverFactory: () => mockProver().prover });
    await createTacitPlugin(host, { config: SELF, accountIndex: 3, proverFactory: () => mockProver().prover });
    expect(deriveAt.mock.calls).toEqual([["m/29793'/1'/0'"], ["m/29793'/1'/3'"]]);
  });

  it('takes an imported identity key instead of touching the keystore', async () => {
    const { open, deriveAt } = setup();
    const plugin = await open();

    expect(await plugin.instanceId()).toBe(aliceKeys.address);
    expect(deriveAt).not.toHaveBeenCalled();
  });

  it('knows the chains the pool is on, and only those', async () => {
    const { host } = setup();
    const elsewhere = { ...host, provider: { ...host.provider, getChainId: async () => 10n } } as Host;

    await expect(createTacitPlugin(elsewhere, { identityKey })).rejects.toBeInstanceOf(UnsupportedChainError);
    expect(Object.keys(TacitConfigs).map(Number).sort((a, b) => a - b)).toEqual([1, 4326, 4663, 8453]);
  });

  it('refuses a relayer URL with no address to hold its quotes to', async () => {
    const { open } = setup();

    await expect(open({ config: { ...SELF, relayerUrl: RELAYER_URL } })).rejects.toThrow(/needs config.relayerAddress/);
  });

  it('refuses relayer mode on a chain without a relayer', async () => {
    const { open } = setup();

    await expect(open({ mode: 'relayer' })).rejects.toThrow(/no relayer/);
  });
});

describe('the prover', () => {
  it('is held to the statement that was built', async () => {
    const t = setup({ notes: [1000n] });
    const lying: TacitProver = { prove: async (input) => { const r = await t.prover.prove(input);

 r.publicSignals[4] = '1';

 return r; } };
    const plugin = await createTacitPlugin(t.host, { config: SELF, identityKey, proverFactory: () => lying });

    await expect(plugin.prepareShield({ asset: ETH, amount: 5n })).rejects.toThrow(/public signals/);
  });
});

describe('balance and notes', () => {
  it('sums unspent notes as ETH and answers zero for other assets', async () => {
    const { open } = setup({ notes: [1000n, 250n] });
    const plugin = await open();
    const usdc: ERC20AssetId = { __type: 'erc20', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };

    expect(await plugin.balance(undefined)).toEqual([{ asset: ETH, amount: 1250n }]);
    expect(await plugin.balance([usdc, ETH])).toEqual([{ asset: usdc, amount: 0n }, { asset: ETH, amount: 1250n }]);
    expect((await plugin.notes()).map((n) => [n.index, n.value])).toEqual([[0, 1000n], [2, 250n]]);
    expect((await plugin.notes())[0]!.leaf).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await plugin.notes([usdc])).toEqual([]);
    expect(await plugin.notes([ETH])).toHaveLength(2);
  });
});

describe('prepareShield', () => {
  it('proves a deposit for this wallet and returns the transaction for the user\'s account to send', async () => {
    const { open, pool, asset } = setup();
    const plugin = await open();
    const op = await plugin.prepareShield({ asset: ETH, amount: 5000n });
    const [tx] = op.txns;

    expect(tx!.to).toBe(pool.config.pool);
    expect(tx!.value).toBe(5000n);

    const { functionName, args } = decode(tx!.data);
    const [, , , publicInputs, recipient, extAmount, relayer, fee, memo0, memo1] = args as unknown as [unknown, unknown, unknown, readonly bigint[], string, bigint, string, bigint, `0x${string}`, `0x${string}`];

    expect(functionName).toBe('transact');
    expect([recipient, relayer, fee, extAmount, memo1]).toEqual([ZERO, ZERO, 0n, 5000n, '0x']);
    expectBound({ ...({} as TransactTx), publicInputs: publicInputs.map(String), recipient: recipient as `0x${string}`, extAmount: String(extAmount), relayer: relayer as `0x${string}`, fee: String(fee), memo0, memo1 }, asset);

    const leaf = BigInt(publicInputs[9]!);

    expect(openNote(aliceKeys, { memo: unhex(memo0), leaf, asset })?.value).toBe(5000n);
  });

  it('can shield to another address', async () => {
    const { open, asset } = setup();
    const op = await (await open()).prepareShield({ asset: { __type: 'native' }, amount: 700n }, bobKeys.address);
    const memo0 = unhex(decode(op.txns[0]!.data).args![8] as string);
    const leaf = BigInt((decode(op.txns[0]!.data).args![3] as unknown as bigint[])[9]!);

    expect(openNote(bobKeys, { memo: memo0, leaf, asset })?.value).toBe(700n);
    expect(openNote(aliceKeys, { memo: memo0, leaf, asset })).toBeNull();
  });

  it('refuses what the pool cannot hold', async () => {
    const plugin = await setup().open();
    const usdc: ERC20AssetId = { __type: 'erc20', contract: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' };

    await expect(plugin.prepareShield({ asset: usdc, amount: 1n })).rejects.toBeInstanceOf(UnsupportedAssetError);
    await expect(plugin.prepareShield({ asset: ETH, amount: 0n })).rejects.toThrow(RangeError);
    await expect(plugin.prepareShield({ asset: ETH, amount: 1n << 120n })).rejects.toThrow(RangeError);
    await expect(plugin.prepareShield({ asset: ETH, amount: 1n }, 'not an address')).rejects.toBeInstanceOf(InvalidAddressError);
  });
});

describe('self mode', () => {
  it('pays another address from the notes it holds, with change and no fee', async () => {
    const { open, asset, inputs } = setup({ notes: [1000n] });
    const op = await (await open()).prepareTransfer({ asset: ETH, amount: 300n }, bobKeys.address);

    expect(op).toMatchObject({ __type: 'privateOperation', mode: 'self', fee: 0n, amount: 300n, chainId: 1 });
    expect(op.relayerUrl).toBeUndefined();
    expect(op.tx.relayer).toBe(ZERO);
    expect(op.tx.extAmount).toBe('0');
    expectBound(op.tx, asset);

    const pay = openNote(bobKeys, { memo: unhex(op.tx.memo0), leaf: BigInt(op.tx.publicInputs[9]!), asset });
    const change = openNote(aliceKeys, { memo: unhex(op.tx.memo1), leaf: BigInt(op.tx.publicInputs[10]!), asset });

    expect(pay?.value).toBe(300n);
    expect(change?.value).toBe(700n);
    expect(inputs[0]!.inV[0]).toBe('1000');
    expect(op.txns[0]).toMatchObject({ to: SELF.pool, value: 0n });
  });

  it('gives a payment with no change a second output all the same, so it looks like one with change', async () => {
    const { open, asset } = setup({ notes: [1000n] });
    const op = await (await open()).prepareTransfer({ asset: ETH, amount: 1000n }, bobKeys.address);

    expect(BigInt(op.tx.publicInputs[10]!)).not.toBe(0n);
    expect(unhex(op.tx.memo1)).toHaveLength(65);
    expect(openNote(aliceKeys, { memo: unhex(op.tx.memo1), leaf: BigInt(op.tx.publicInputs[10]!), asset })?.value).toBe(0n);
    expectBound(op.tx, asset);
  });

  it('withdraws to a public address and spends the note outright when nothing is left over', async () => {
    const { open, asset } = setup({ notes: [1000n] });
    const op = await (await open()).prepareUnshield({ asset: ETH, amount: 1000n }, FRESH);

    expect(op.tx).toMatchObject({ recipient: FRESH, extAmount: '-1000', memo0: '0x', memo1: '0x' });
    expect(BigInt(op.tx.publicInputs[9]!)).toBe(0n);
    expectBound(op.tx, asset);
  });

  it('refuses a withdrawal address that is not an address, or is zero', async () => {
    const plugin = await setup({ notes: [1000n] }).open();

    await expect(plugin.prepareUnshield({ asset: ETH, amount: 1n }, '0x1234')).rejects.toBeInstanceOf(InvalidAddressError);
    await expect(plugin.prepareUnshield({ asset: ETH, amount: 1n }, ZERO)).rejects.toBeInstanceOf(InvalidAddressError);
    await expect(plugin.prepareUnshield({ asset: ETH, amount: 1n }, '0xDEADbeef00000000000000000000000000000001')).rejects.toBeInstanceOf(InvalidAddressError);
    await expect(plugin.prepareUnshield({ asset: ETH, amount: 1n }, FRESH, { tailCalls: async () => [] })).rejects.toThrow(/tailCalls/);
  });

  it('says whether it is the balance or the number of notes that falls short', async () => {
    const plugin = await setup({ notes: [100n, 100n, 100n] }).open();

    await expect(plugin.prepareUnshield({ asset: ETH, amount: 301n }, FRESH)).rejects.toBeInstanceOf(InsufficientBalanceError);
    await expect(plugin.prepareUnshield({ asset: ETH, amount: 250n }, FRESH)).rejects.toBeInstanceOf(TacitFragmentedBalanceError);
    await expect(plugin.prepareTransfer({ asset: ETH, amount: 250n }, bobKeys.address)).rejects.toBeInstanceOf(TacitFragmentedBalanceError);
    await expect(plugin.prepareTransfer({ asset: ETH, amount: 5n }, 'bp1nothing')).rejects.toBeInstanceOf(InvalidAddressError);
  });

  it('merges the two largest notes', async () => {
    const { open, asset } = setup({ notes: [100n, 300n, 200n] });
    const op = await (await open()).prepareConsolidate();
    const merged = openNote(aliceKeys, { memo: unhex(op.tx.memo0), leaf: BigInt(op.tx.publicInputs[9]!), asset });

    expect(merged?.value).toBe(500n);
    expect(op.amount).toBe(500n);
    expectBound(op.tx, asset);
    await expect((await setup({ notes: [100n] }).open()).prepareConsolidate()).rejects.toThrow(/two notes/);
  });

  it('spends the smallest note that covers the amount', async () => {
    const { open, inputs } = setup({ notes: [900n, 120n, 400n] });

    await (await open()).prepareUnshield({ asset: ETH, amount: 100n }, FRESH);
    expect(inputs[0]!.inV[0]).toBe('120');
  });
});

describe('relayer mode', () => {
  const quote = { chainId: 1, pool: SELF.pool, relayer: TacitConfigs[1]!.relayerAddress, fee: '40', gas: '450000', asset: ZERO };

  function relayerFetch(pool: ModelPool, overrides: { quote?: unknown; head?: unknown } = {}) {
    const calls: Array<{ url: string; body?: string }> = [];
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      calls.push({ url, body: init?.body as string | undefined });

      if (url === `${RELAYER_URL}/quote`) return Response.json(overrides.quote ?? quote);

      if (url === `${RELAYER_URL}/head`) {
        const head = { root: pool.tree.root.toString(), size: String(pool.tree.size), pending: [], tail: { root: pool.tree.root.toString(), size: String(pool.tree.size) } };

        return Response.json(overrides.head ?? head);
      }

      if (url === `${RELAYER_URL}/relay`) return Response.json({ txHash: '0x' + 'cd'.repeat(32) });

      return new Response('{}', { status: 404 });
    };

    return { fetch, calls };
  }

  it('adds the relayer\'s fee on top of the amount and names the relayer in the proof', async () => {
    const t = setup({ notes: [1000n] });
    const { fetch, calls } = relayerFetch(t.pool);
    const plugin = await createTacitPlugin({ ...t.host, network: { fetch } }, { config: WITH_RELAYER, identityKey, proverFactory: () => t.prover });
    const op = await plugin.prepareUnshield({ asset: ETH, amount: 500n }, FRESH);

    expect(op).toMatchObject({ mode: 'relayer', relayerUrl: RELAYER_URL, fee: 40n, amount: 500n });
    expect(op.tx).toMatchObject({ relayer: TacitConfigs[1]!.relayerAddress, fee: '40', recipient: FRESH, extAmount: '-500' });
    expectBound(op.tx, t.asset);

    const change = openNote(aliceKeys, { memo: unhex(op.tx.memo0), leaf: BigInt(op.tx.publicInputs[9]!), asset: t.asset });

    expect(change?.value).toBe(460n);
    expect(await plugin.quote()).toBe(40n);

    const sent = await createTacitBroadcaster({ ...t.host, network: { fetch } }).broadcast(op);

    expect(sent.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JSON.parse(calls.at(-1)!.body!).tx).toEqual(op.tx);
  });

  it('proves against the insertions the relayer has queued', async () => {
    const t = setup({ notes: [1000n] });
    const { tree } = t.pool;
    const queued = tree.clone();

    queued.append([777n, 888n]);

    const head = {
      root: tree.root.toString(), size: String(tree.size),
      pending: [{ outLeaf0: '777', outLeaf1: '888' }], tail: { root: queued.root.toString(), size: String(queued.size) },
    };
    const { fetch } = relayerFetch(t.pool, { head });
    const plugin = await createTacitPlugin({ ...t.host, network: { fetch } }, { config: WITH_RELAYER, identityKey, proverFactory: () => t.prover });

    await plugin.prepareTransfer({ asset: ETH, amount: 100n }, bobKeys.address);
    expect(t.inputs[0]!.startIndex).toBe(String(tree.size + 2));
    expect(t.inputs[0]!.root).toBe(queued.root.toString());
  });

  it('reads the pool again when it has moved since the last read, so the proof is not stale', async () => {
    const t = setup({ notes: [1000n] });
    const asset = t.asset;
    const { fetch } = relayerFetch(t.pool);
    const moving = async (input: RequestInfo | URL, init?: RequestInit) => {
      // Another wallet's transaction lands while this one is being prepared.
      if (String(input).endsWith('/quote') && t.pool.logs.length === 1) {
        t.pool.add({ block: 1001, outs: [sealNote(bobKeys, 5n, asset), null] });
        t.pool.tip = 1001;
      }

      return fetch(input, init);
    };
    const plugin = await createTacitPlugin({ ...t.host, network: { fetch: moving } }, { config: WITH_RELAYER, identityKey, proverFactory: () => t.prover });

    await plugin.prepareTransfer({ asset: ETH, amount: 100n }, bobKeys.address);
    expect(t.pool.tree.size).toBe(4);
    expect(t.inputs[0]!.startIndex).toBe('4');
    expect(t.inputs[0]!.root).toBe(t.pool.tree.root.toString());
  });

  it('proves against the pool\'s own head when the relayer\'s queue does not add up', async () => {
    const t = setup({ notes: [1000n] });
    const head = { root: t.pool.tree.root.toString(), size: '2', pending: [{ outLeaf0: '1', outLeaf1: '2' }], tail: { root: '12345', size: '4' } };
    const plugin = await createTacitPlugin({ ...t.host, network: { fetch: relayerFetch(t.pool, { head }).fetch } }, { config: WITH_RELAYER, identityKey, proverFactory: () => t.prover });

    await plugin.prepareTransfer({ asset: ETH, amount: 100n }, bobKeys.address);
    expect(t.inputs[0]!.startIndex).toBe(String(t.pool.tree.size));
  });

  it('refuses a fee above the chain\'s ceiling before proving anything', async () => {
    const t = setup({ notes: [1000n] });
    const dear = { ...quote, fee: (WITH_RELAYER.maxRelayFee + 1n).toString() };
    const plugin = await createTacitPlugin({ ...t.host, network: { fetch: relayerFetch(t.pool, { quote: dear }).fetch } }, { config: WITH_RELAYER, identityKey, proverFactory: () => t.prover });

    await expect(plugin.prepareTransfer({ asset: ETH, amount: 100n }, bobKeys.address)).rejects.toBeInstanceOf(TacitFeeError);
    expect(t.inputs).toHaveLength(0);
  });

  it('does not follow the relayer\'s queue when the spend inserts nothing', async () => {
    const t = setup({ notes: [1000n] });
    const queued = t.pool.tree.clone();

    queued.append([777n, 888n]);

    const head = {
      root: t.pool.tree.root.toString(), size: String(t.pool.tree.size),
      pending: [{ outLeaf0: '777', outLeaf1: '888' }], tail: { root: queued.root.toString(), size: String(queued.size) },
    };
    const plugin = await createTacitPlugin({ ...t.host, network: { fetch: relayerFetch(t.pool, { head }).fetch } }, { config: WITH_RELAYER, identityKey, proverFactory: () => t.prover });

    // 960 and a fee of 40 take the whole note: no change, so nothing is inserted and the root must be one the pool has held.
    await plugin.prepareUnshield({ asset: ETH, amount: 960n }, FRESH);
    expect(t.inputs[0]!.root).toBe(t.pool.tree.root.toString());
    expect(t.inputs[0]!.outLeaf).toEqual(['0', '0']);
  });

  it('refuses a fee above the one the caller was shown', async () => {
    const t = setup({ notes: [1000n] });
    const plugin = await createTacitPlugin({ ...t.host, network: { fetch: relayerFetch(t.pool).fetch } }, { config: WITH_RELAYER, identityKey, proverFactory: () => t.prover });

    await expect(plugin.prepareTransfer({ asset: ETH, amount: 100n }, bobKeys.address, { maxFee: 39n })).rejects.toBeInstanceOf(TacitFeeError);
    await expect(plugin.prepareUnshield({ asset: ETH, amount: 100n }, FRESH, { maxFee: 39n })).rejects.toBeInstanceOf(TacitFeeError);
    await expect(plugin.prepareConsolidate({ maxFee: 39n })).rejects.toThrow();
    expect(t.inputs).toHaveLength(0);
    expect((await plugin.prepareTransfer({ asset: ETH, amount: 100n }, bobKeys.address, { maxFee: 40n })).fee).toBe(40n);
  });

  it('lets a transfer or a merge choose self mode too', async () => {
    const t = setup({ notes: [1000n, 500n] });
    const { fetch, calls } = relayerFetch(t.pool);
    const plugin = await createTacitPlugin({ ...t.host, network: { fetch } }, { config: WITH_RELAYER, identityKey, proverFactory: () => t.prover });

    expect(await plugin.prepareTransfer({ asset: ETH, amount: 100n }, bobKeys.address, { mode: 'self' })).toMatchObject({ mode: 'self', fee: 0n });
    expect(await plugin.prepareConsolidate({ mode: 'self' })).toMatchObject({ mode: 'self', fee: 0n });
    expect(calls.some((c) => c.url.endsWith('/quote'))).toBe(false);
  });

  it('lets one call choose self mode, and the broadcaster refuses an operation the user sends', async () => {
    const t = setup({ notes: [1000n] });
    const { fetch, calls } = relayerFetch(t.pool);
    const plugin = await createTacitPlugin({ ...t.host, network: { fetch } }, { config: WITH_RELAYER, identityKey, proverFactory: () => t.prover });
    const op = await plugin.prepareUnshield({ asset: ETH, amount: 100n }, FRESH, { mode: 'self' } as never);

    expect(op).toMatchObject({ mode: 'self', fee: 0n });
    expect(calls.some((c) => c.url.endsWith('/quote'))).toBe(false);
    await expect(createTacitBroadcaster(t.host).broadcast(op)).rejects.toThrow(/own account/);
  });
});

describe('addresses', () => {
  it('derives a different wallet for each account index', () => {
    expect(decodeAddress(aliceKeys.address).V.equals(aliceKeys.V)).toBe(true);
    expect(aliceKeys.address).not.toBe(bobKeys.address);
  });
});

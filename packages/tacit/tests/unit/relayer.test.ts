import type { Network } from '@kohaku-eth/plugins';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TacitConfigs, TacitFeeError, TacitRelayerError, TacitStaleProofError } from '../../src';
import { relaySpend, TacitRelayerClient } from '../../src/relayer/client';
import type { TransactTx } from '../../src/pool/abi';

const config = TacitConfigs[1]!;
const URL = 'https://relayer.test/evm-pool/keeper';
const quote = { chainId: 1, pool: config.pool, relayer: config.relayerAddress!, fee: '67304245680000', gas: '450000', asset: '0x0000000000000000000000000000000000000000' };

const tx: TransactTx = {
  pA: ['1', '2'], pB: [['3', '4'], ['5', '6']], pC: ['7', '8'], publicInputs: Array(11).fill('0'),
  recipient: '0x0000000000000000000000000000000000000001', extAmount: '-5', relayer: config.relayerAddress!, fee: '100', memo0: '0x', memo1: '0x',
};

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

function network(...replies: Reply[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });

    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;

    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: reply.headers });
  });

  return { net: { fetch } as unknown as Network, calls };
}

afterEach(() => vi.useRealTimers());

describe('TacitRelayerClient.quote', () => {
  const client = (net: Network, cfg = config) => new TacitRelayerClient(net, cfg, URL);

  it('returns a quote for this chain and pool from the expected relayer', async () => {
    const { net, calls } = network({ body: quote });

    expect((await client(net).quote()).fee).toBe(quote.fee);
    expect(calls[0]!.url).toBe(`${URL}/quote`);

    await client(network({ body: quote }).net).quote(900_000);
  });

  it('prices a heavier spend by asking for its gas', async () => {
    const { net, calls } = network({ body: quote });

    await client(net).quote(900_000);
    expect(calls[0]!.url).toBe(`${URL}/quote?gas=900000`);
  });

  it.each([
    ['another chain', { ...quote, chainId: 8453 }],
    ['another pool', { ...quote, pool: '0x0000000000000000000000000000000000000002' }],
    ['an unexpected relayer address', { ...quote, relayer: '0x0000000000000000000000000000000000000003' }],
    ['a malformed relayer address', { ...quote, relayer: 'nope' }],
    ['a fee that is not a number', { ...quote, fee: '12.5' }],
  ])('refuses a quote for %s', async (_, body) => {
    await expect(client(network({ body }).net).quote()).rejects.toBeInstanceOf(TacitRelayerError);
  });

  it('refuses a fee above the chain\'s ceiling', async () => {
    const error = await client(network({ body: { ...quote, fee: (config.maxRelayFee + 1n).toString() } }).net).quote().catch((e) => e);

    expect(error).toBeInstanceOf(TacitFeeError);
    expect(error.limit).toBe(config.maxRelayFee);
  });

  it('accepts any relayer address when the config pins none', async () => {
    const open = { ...config, relayerAddress: undefined };

    expect((await client(network({ body: { ...quote, relayer: '0x0000000000000000000000000000000000000003' } }).net, open).quote()).fee).toBe(quote.fee);
  });

  it('turns an error reply into a TacitRelayerError carrying the status', async () => {
    const error = await client(network({ status: 404, body: { error: 'relaying is off' } }).net).quote().catch((e) => e);

    expect(error).toBeInstanceOf(TacitRelayerError);
    expect(error.status).toBe(404);
    expect(error.message).toBe('relaying is off');
  });

  it('waits out a busy relayer and asks again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });

    const { net, calls } = network({ status: 429, headers: { 'retry-after': '2' } }, { body: quote });
    const pending = client(net).quote();

    await vi.advanceTimersByTimeAsync(5000);
    expect((await pending).fee).toBe(quote.fee);
    expect(calls).toHaveLength(2);
  });
});

describe('relaySpend', () => {
  const hash = '0x' + 'ab'.repeat(32);

  it('posts the transaction and returns the hash', async () => {
    const { net, calls } = network({ body: { txHash: hash } });

    expect(await relaySpend(net, URL, tx)).toBe(hash);
    expect(calls[0]!.url).toBe(`${URL}/relay`);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ tx });
  });

  it.each([
    ['a stale root', { status: 409, body: { error: 'StaleRoot: re-prove against the pool\'s current root', stale: true } }, TacitStaleProofError],
    ['funds already spent', { status: 409, body: { error: 'AlreadyNullified: re-prove', stale: true } }, TacitRelayerError],
    ['a spend already in flight', { status: 409, body: { error: 'this spend is already being relayed', stale: true } }, TacitRelayerError],
    ['a fee that no longer covers the gas', { status: 400, body: { error: 'fee too low: gas', needFee: '90000' } }, TacitFeeError],
    ['a gateway failure with no answer', { status: 504, body: {} }, TacitRelayerError],
    ['a refusal with a reason', { status: 400, body: { error: 'the transaction reverts: BadProof' } }, TacitRelayerError],
  ])('maps %s', async (_, reply, type) => {
    const error = await relaySpend(network(reply).net, URL, tx).catch((e) => e);

    expect(error).toBeInstanceOf(type);
  });

  it('treats a request that got no answer at all as one that may have been sent', async () => {
    const down = { fetch: async () => { throw new TypeError('fetch failed'); } } as unknown as Network;
    const error = await relaySpend(down, URL, tx).catch((e) => e);

    expect(error).toBeInstanceOf(TacitRelayerError);
    expect(error.message).toMatch(/may still have sent/);
  });

  it('says what a missing answer means', async () => {
    const error = await relaySpend(network({ status: 502, body: {} }).net, URL, tx).catch((e) => e);

    expect(error.message).toMatch(/may still have sent/);
    expect(error.status).toBe(502);
  });

  it('reports the relayer\'s own reason when it has one', async () => {
    const error = await relaySpend(network({ status: 503, body: { error: 'the relayer is out of gas money' } }).net, URL, tx).catch((e) => e);

    expect(error.message).toBe('the relayer is out of gas money');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { concat, encodeAbiParameters, getAddress } from 'viem';
import { relayDataAbi } from '../../src/data/abis/entrypoint.abi';
import type { Address } from '../../src/interfaces/types.interface';
import type { IQuoteResponse, IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
import { PPv1RelayerQuoteError } from '../../src/relayer/quote-error';
import { RelayerClient } from '../../src/relayer/relayer-client';
import { storeStateManager, type StoreFactoryParams } from '../../src/state/state-manager';
import { storeFactory } from '../../src/state/store';
import { quoteThunk, validateWithdrawalData } from '../../src/state/thunks/quoteThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const USER = getAddress('0x1111111111111111111111111111111111111111');
const RELAYER = getAddress('0x2222222222222222222222222222222222222222');
const ASSET = 0x3333n as Address;

const relayData = (recipient: `0x${string}`, relayFeeBps: bigint) =>
  encodeAbiParameters([relayDataAbi], [{ recipient, feeRecipient: RELAYER, relayFeeBps }]);

const quote = (withdrawalData: string, feeBPS: string): IQuoteResponse => ({
  baseFeeBPS: '0',
  feeBPS,
  gasPrice: '1',
  feeCommitment: { expiration: Date.now() + 60_000, withdrawalData, signedRelayerCommitment: '0x' },
  detail: { relayTxCost: { gas: '0', eth: '0' } },
});

afterEach(() => vi.restoreAllMocks());

describe('RelayerClient.getQuote', () => {
  const request = { asset: ASSET, recipient: BigInt(USER), chainId: 1n, amount: 10n ** 18n + 1n, relayerUrl: 'https://relayer.test' };

  it('sends the amount as an exact decimal string', async () => {
    const expected = quote(relayData(USER, 100n), '100');
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(expected));
    const client = new RelayerClient({ network: { fetch } });

    expect(await client.getQuote(request)).toEqual(expected);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]?.body)).amount).toBe('1000000000000000001');
  });

  it('reports HTTP failures with JSON or plain-text reasons', async () => {
    for (const [status, body, reason] of [
      [400, JSON.stringify({ error: 'Amount must be a positive integer' }), 'Amount must be a positive integer'],
      [503, 'upstream unavailable', 'upstream unavailable'],
    ] as const) {
      const client = new RelayerClient({ network: { fetch: vi.fn().mockResolvedValue(new Response(body, { status })) } });

      await expect(client.getQuote(request)).rejects.toThrow(`Quote request failed (HTTP ${status}): ${reason}`);
    }
  });
});

describe('validateWithdrawalData', () => {
  it('accepts relay data that pays the requested recipient within the quoted fee', () => {
    const decoded = validateWithdrawalData(quote(relayData(USER, 100n), '100'), BigInt(USER), 500n);

    expect(decoded.recipient).toBe(USER);
    expect(decoded.relayFeeBps).toBe(100n);
  });

  it('rejects relay data that pays someone else', () => {
    expect(() => validateWithdrawalData(quote(relayData(RELAYER, 0n), '0'), BigInt(USER)))
      .toThrow(/not the requested recipient/);
  });

  it('rejects an embedded fee above the quoted feeBPS or the pool maximum', () => {
    expect(() => validateWithdrawalData(quote(relayData(USER, 9_000n), '100'), BigInt(USER)))
      .toThrow(/exceeds the quoted/);
    expect(() => validateWithdrawalData(quote(relayData(USER, 600n), '600'), BigInt(USER), 500n))
      .toThrow(/maxRelayFeeBPS/);
  });

  it('rejects non-canonical encodings', () => {
    const canonical = relayData(USER, 100n);
    const dirtyAddress = `0x${'ff'.repeat(12)}${canonical.slice(26)}` as `0x${string}`;

    expect(() => validateWithdrawalData(quote(concat([canonical, '0x00']), '100'), BigInt(USER)))
      .toThrow(/canonical/);
    expect(() => validateWithdrawalData(quote(dirtyAddress, '100'), BigInt(USER)))
      .toThrow(/canonical/);
    expect(() => validateWithdrawalData(quote('not hex', '100'), BigInt(USER))).toThrow(/hex/);
  });
});

describe('quoteThunk', () => {
  const store = () => storeFactory({
    logLevel: 'off',
    devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress: 900n as Address, deploymentBlock: 0n },
  });

  const relayerClient = (quotes: Record<string, IQuoteResponse>): IRelayerClient => ({
    getQuote: async ({ relayerUrl }) => quotes[relayerUrl]!,
    relay: async () => { throw new Error('not used'); },
    getFees: async () => { throw new Error('not used'); },
  });

  const getBestQuote = (quotes: Record<string, IQuoteResponse>, maxRelayFeeBPS?: bigint) =>
    store().dispatch(quoteThunk({
      relayerClient: relayerClient(quotes),
      relayers: new Map(Object.keys(quotes).map((url) => [url, url])),
      asset: ASSET,
      amount: 10n ** 18n,
      recipient: BigInt(USER),
      maxRelayFeeBPS,
    })).unwrap();

  it('skips a relayer that names itself as recipient, even when it quotes 0 bps', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const best = await getBestQuote({
      thief: quote(relayData(RELAYER, 0n), '0'),
      honest: quote(relayData(USER, 100n), '100'),
    });

    expect(best.relayerId).toBe('honest');
    expect(best.relayData.recipient).toBe(USER);

    await expect(getBestQuote({ thief: quote(relayData(RELAYER, 0n), '0') }))
      .rejects.toThrow('All relayers failed to provide a quote');
  });

  it('ranks quotes by the embedded fee, not the advertised one', async () => {
    const best = await getBestQuote({
      cheapEmbedded: quote(relayData(USER, 50n), '200'),
      cheapAdvertised: quote(relayData(USER, 60n), '60'),
    });

    expect(best.relayerId).toBe('cheapEmbedded');
    expect(best.relayData.relayFeeBps).toBe(50n);
  });

  it('preserves per-relayer failures through estimation and withdrawal preparation', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let servesQuote = true;
    const relayerClient = new RelayerClient({ network: { fetch: async (url) => String(url).startsWith('https://expensive.test')
      ? servesQuote ? Response.json(quote(relayData(USER, 600n), '600')) : new Response('upstream unavailable', { status: 503 })
      : Response.json({ error: 'Amount must be a positive integer' }, { status: 400 }) } });
    const proverFactory = vi.fn();
    const manager = storeStateManager({
      entrypoint: { address: 900n, deploymentBlock: 0n }, secretManager: {}, proverFactory,
      dataService: { getChainId: async () => 1n, getPoolForAsset: async () => ({ maxRelayFeeBPS: 500n }) },
      relayerClient, relayersList: new Map([['expensive', 'https://expensive.test'], ['offline', 'https://offline.test']]),
    } as unknown as StoreFactoryParams);
    const request = { asset: ASSET, amount: 10n ** 18n, recipient: BigInt(USER) };

    for (const prepare of [() => manager.getUnshieldEstimate(request), () => manager.getWithdrawalPayloads(request)]) {
      const error: unknown = await prepare().catch((error: unknown) => error);

      expect(error).toBeInstanceOf(PPv1RelayerQuoteError);
      expect(error).toMatchObject({ failures: [
        { relayerId: 'expensive', relayerUrl: 'https://expensive.test', reason: 'fee-too-high', requiredFeeBPS: 600n, maxRelayFeeBPS: 500n },
        { relayerId: 'offline', reason: 'quote-failed', message: 'Quote request failed (HTTP 400): Amount must be a positive integer' },
      ] });
    }

    servesQuote = false;
    const error: unknown = await manager.getExactWithdrawalPayloads({
      asset: ASSET, recipient: BigInt(USER), requestedNet: request.amount, gasBumpBPS: 0n,
    }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(PPv1RelayerQuoteError);
    expect(error).toMatchObject({ failures: [
      { relayerId: 'expensive', message: 'Quote request failed (HTTP 503): upstream unavailable' },
      { relayerId: 'offline', message: 'Quote request failed (HTTP 400): Amount must be a positive integer' },
    ] });
    expect(proverFactory).not.toHaveBeenCalled();
  });
});

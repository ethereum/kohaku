import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { concat, encodeAbiParameters, getAddress } from 'viem';
import { relayDataAbi } from '../../src/data/abis/entrypoint.abi';
import type { Address } from '../../src/interfaces/types.interface';
import type { IQuoteResponse, IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
import { PPv1RelayerQuoteError } from '../../src/relayer/quote-error';
import { RelayerClient } from '../../src/relayer/relayer-client';
import { storeStateManager, type StoreFactoryParams } from '../../src/state/state-manager';
import { storeFactory } from '../../src/state/store';
import { QUOTE_COLLECTION_WINDOW_MS, quoteThunk, validateFeeCommitment, validateWithdrawalData } from '../../src/state/thunks/quoteThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const USER = getAddress('0x1111111111111111111111111111111111111111');
const RELAYER = getAddress('0x2222222222222222222222222222222222222222');
const ASSET = 0x3333n as Address;
const SIGNATURE = `0x${'5e'.repeat(65)}`;

const relayData = (recipient: `0x${string}`, relayFeeBps: bigint) =>
  encodeAbiParameters([relayDataAbi], [{ recipient, feeRecipient: RELAYER, relayFeeBps }]);

/** `quote` with its fee commitment's expiration or signature replaced. */
const withCommitment = (base: IQuoteResponse, commitment: Record<string, unknown>): IQuoteResponse =>
  ({ ...base, feeCommitment: { ...base.feeCommitment, ...commitment } } as IQuoteResponse);

const quote = (withdrawalData: string, feeBPS: string): IQuoteResponse => ({
  baseFeeBPS: '0',
  feeBPS,
  gasPrice: '1',
  feeCommitment: { expiration: Date.now() + 60_000, withdrawalData, signedRelayerCommitment: SIGNATURE },
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

describe('validateFeeCommitment', () => {
  const NOW = 1_700_000_000_000;
  const valid = () => quote(relayData(USER, 100n), '100');

  it('accepts a signed quote that has not expired', () => {
    expect(() => validateFeeCommitment(withCommitment(valid(), { expiration: NOW + 1 }), { now: NOW })).not.toThrow();
  });

  it.each([
    ['at its expiration', { expiration: NOW }, 'quote expired 0 ms ago'],
    ['past its expiration', { expiration: NOW - 5_000 }, 'quote expired 5000 ms ago'],
    ['without an expiration', { expiration: undefined }, 'quote has no expiration'],
    ['with a non-numeric expiration', { expiration: '9999999999999' }, 'quote has no expiration'],
  ])('rejects a quote %s', (_case, commitment, message) => {
    expect(() => validateFeeCommitment(withCommitment(valid(), commitment), { now: NOW })).toThrow(message);
  });

  it.each([undefined, '', '0x', '0xmocksignature', 42])('rejects the signature %s', (signedRelayerCommitment) => {
    const unsigned = withCommitment(valid(), { expiration: NOW + 1, signedRelayerCommitment });

    expect(() => validateFeeCommitment(unsigned, { now: NOW })).toThrow('quote has no signed fee commitment');
    expect(() => validateFeeCommitment(unsigned, { now: NOW, requireCommitment: false })).not.toThrow();
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

  const getBestQuote = (quotes: Record<string, IQuoteResponse>, maxRelayFeeBPS?: bigint, requireCommitment?: boolean) =>
    store().dispatch(quoteThunk({
      relayerClient: relayerClient(quotes),
      relayers: new Map(Object.keys(quotes).map((url) => [url, url])),
      asset: ASSET,
      amount: 10n ** 18n,
      recipient: BigInt(USER),
      maxRelayFeeBPS,
      requireCommitment,
    })).unwrap();

  it.each([
    ['an expired quote', { expiration: Date.now() - 1 }],
    ['a quote without a signature', { signedRelayerCommitment: '0x' }],
  ])('drops the cheapest relayer when it serves %s, before ranking', async (_case, commitment) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const best = await getBestQuote({
      cheapest: withCommitment(quote(relayData(USER, 10n), '10'), commitment),
      valid: quote(relayData(USER, 100n), '100'),
    });

    expect(best.relayerId).toBe('valid');
  });

  it('reports the stale quote when it is the only one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const error = await getBestQuote({ stale: withCommitment(quote(relayData(USER, 10n), '10'), { expiration: Date.now() - 1 }) }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PPv1RelayerQuoteError);
    expect((error as PPv1RelayerQuoteError).failures).toEqual([expect.objectContaining({ relayerId: 'stale', reason: 'quote-failed', message: expect.stringMatching(/^quote expired/) })]);
  });

  it('still ranks an unsigned quote for exact output, which omits the commitment, but not an expired one', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const unsigned = await getBestQuote({
      cheapest: withCommitment(quote(relayData(USER, 10n), '10'), { signedRelayerCommitment: undefined }),
      signed: quote(relayData(USER, 100n), '100'),
    }, undefined, false);

    expect(unsigned.relayerId).toBe('cheapest');

    const expired = await getBestQuote({
      cheapest: withCommitment(quote(relayData(USER, 10n), '10'), { expiration: Date.now() - 1 }),
      signed: quote(relayData(USER, 100n), '100'),
    }, undefined, false);

    expect(expired.relayerId).toBe('signed');
  });

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

describe('quote collection window', () => {
  const store = () => storeFactory({
    logLevel: 'off',
    devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress: 900n as Address, deploymentBlock: 0n },
  });

  /** Relayers that answer after `delay` ms (never when undefined), each with a quote built at answer time. */
  const relayers = (answers: Record<string, { delay?: number; quote: () => IQuoteResponse }>) => {
    const client: IRelayerClient = {
      getQuote: ({ relayerUrl }) => new Promise((resolve) => {
        const { delay, quote: build } = answers[relayerUrl]!;

        if (delay !== undefined) setTimeout(() => resolve(build()), delay);
      }),
      relay: async () => { throw new Error('not used'); },
      getFees: async () => { throw new Error('not used'); },
    };

    let settled = false;
    const result = store().dispatch(quoteThunk({
      relayerClient: client,
      relayers: new Map(Object.keys(answers).map((url) => [url, url])),
      asset: ASSET,
      amount: 10n ** 18n,
      recipient: BigInt(USER),
    })).unwrap().finally(() => { settled = true; });

    result.catch(() => {});

    return { result, isSettled: () => settled };
  };
  /** A quote at `feeBPS`, valid for `lifetimeMs` from when it is built. */
  const quoteAt = (feeBPS: bigint, lifetimeMs = 60_000) => () =>
    withCommitment(quote(relayData(USER, feeBPS), String(feeBPS)), { expiration: Date.now() + lifetimeMs });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it('ignores a cheaper, longer-lived quote that arrives after the window', async () => {
    const { result } = relayers({
      honest: { delay: 100, quote: quoteAt(100n) },
      late: { delay: 100 + QUOTE_COLLECTION_WINDOW_MS + 1_000, quote: quoteAt(1n, 3_600_000) },
    });

    await vi.advanceTimersByTimeAsync(100 + QUOTE_COLLECTION_WINDOW_MS);

    expect((await result).relayerId).toBe('honest');
  });

  it('ranks as soon as every relayer has answered', async () => {
    const { result, isSettled } = relayers({ a: { delay: 100, quote: quoteAt(100n) }, b: { delay: 300, quote: quoteAt(50n) } });

    await vi.advanceTimersByTimeAsync(300);

    expect(isSettled()).toBe(true);
    expect((await result).relayerId).toBe('b');
  });

  it('does not start the window on an invalid reply', async () => {
    const { result, isSettled } = relayers({
      thief: { delay: 10, quote: () => quote(relayData(RELAYER, 0n), '0') },
      honest: { delay: 10 + QUOTE_COLLECTION_WINDOW_MS + 1_000, quote: quoteAt(100n) },
      silent: { quote: quoteAt(1n) },
    });

    await vi.advanceTimersByTimeAsync(10 + QUOTE_COLLECTION_WINDOW_MS + 1_000);

    expect(isSettled()).toBe(false);
    await vi.advanceTimersByTimeAsync(QUOTE_COLLECTION_WINDOW_MS);
    expect((await result).relayerId).toBe('honest');
  });

  it('drops a quote that expires before ranking, and reports relayers that did not answer in time', async () => {
    const short = relayers({
      short: { delay: 100, quote: quoteAt(10n, 2_000) },
      valid: { delay: 3_000, quote: quoteAt(100n) },
      silent: { quote: quoteAt(1n) },
    });

    await vi.advanceTimersByTimeAsync(100 + QUOTE_COLLECTION_WINDOW_MS);
    expect((await short.result).relayerId).toBe('valid');

    const none = relayers({ short: { delay: 100, quote: quoteAt(10n, 2_000) }, silent: { quote: quoteAt(1n) } });

    await vi.advanceTimersByTimeAsync(100 + QUOTE_COLLECTION_WINDOW_MS);
    const error = await none.result.catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PPv1RelayerQuoteError);
    expect((error as PPv1RelayerQuoteError).failures).toEqual([
      expect.objectContaining({ relayerId: 'short', message: expect.stringMatching(/^quote expired \d+ ms before ranking$/) }),
      expect.objectContaining({ relayerId: 'silent', message: `no quote within ${QUOTE_COLLECTION_WINDOW_MS} ms of the first valid one` }),
    ]);
  });
});

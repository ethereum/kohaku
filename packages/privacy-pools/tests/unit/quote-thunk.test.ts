import { describe, expect, it, vi } from 'vitest';
import { concat, encodeAbiParameters, getAddress } from 'viem';
import { relayDataAbi } from '../../src/data/abis/entrypoint.abi';
import type { Address } from '../../src/interfaces/types.interface';
import type { IQuoteResponse, IRelayerClient } from '../../src/relayer/interfaces/relayer-client.interface';
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
});

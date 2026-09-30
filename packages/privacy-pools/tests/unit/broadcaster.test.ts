import { describe, expect, it } from 'vitest';

import { PrivacyPoolsBroadcaster } from '../../src/plugin/broadcaster';
import { IRelayRequest } from '../../src/relayer/interfaces/relayer-client.interface';

/** Builds a relayer private operation; set `exact` to mark it as exact-output. */
const makeRelayerOp = (exact?: object) => ({
  mode: 'relayer',
  rawData: {
    chainId: 1n,
    scope: 2n,
    context: 0n,
    relayData: { recipient: '0x0', feeRecipient: '0x0', relayFeeBps: 115n },
    proof: { proof: { pi_a: [], pi_b: [], pi_c: [] }, publicSignals: ['1', '2'] },
    withdrawalPayload: { processooor: '0xabc', data: '0xdef' },
  },
  txData: { to: '0xabc', data: '0xdef', value: 0n },
  quoteData: {
    relayerId: 'mock-relayer',
    quote: {
      baseFeeBPS: '50',
      feeBPS: '100',
      gasPrice: '1',
      feeCommitment: {
        expiration: 1,
        withdrawalData: '0xdead',
        signedRelayerCommitment: '0xsig',
      },
      detail: { relayTxCost: { gas: '0', eth: '0' } },
    },
  },
  ...(exact ? { exact } : {}),
});

const setup = () => {
  let captured: IRelayRequest | undefined;
  const relayerClient = {
    getQuote: async () => { throw new Error('not used'); },
    getFees: async () => { throw new Error('not used'); },
    relay: async (body: IRelayRequest) => {
      captured = body;

      return { success: true as const, timestamp: 0, requestId: 'x', txHash: '0x00' as const };
    },
  };
  const broadcaster = new PrivacyPoolsBroadcaster({
    host: {} as never,
    broadcasterUrl: { 'mock-relayer': 'http://mock.relayer' },
    relayerClientFactory: () => relayerClient,
    paymasterClientFactory: () => ({} as never),
  });

  return { broadcaster, getCaptured: () => captured };
};

describe('PrivacyPoolsBroadcaster relayer path', () => {
  it('forwards the quote feeCommitment for a normal withdrawal', async () => {
    const { broadcaster, getCaptured } = setup();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await broadcaster.broadcast(makeRelayerOp() as any);

    expect(getCaptured()?.feeCommitment).toBeDefined();
    expect(getCaptured()?.feeCommitment?.withdrawalData).toBe('0xdead');
  });

  it('omits the feeCommitment for an exact-output withdrawal', async () => {
    const { broadcaster, getCaptured } = setup();
    const exact = { grossAmount: 2n, requestedNet: 1n, expectedNet: 1n, fee: 1n };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await broadcaster.broadcast(makeRelayerOp(exact) as any);

    expect(getCaptured()?.feeCommitment).toBeUndefined();
  });
});

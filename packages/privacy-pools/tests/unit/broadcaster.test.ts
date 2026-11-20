import { toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import { PrivacyPoolsBroadcaster } from '../../src/plugin/broadcaster';
import { PaymasterBroadcastError } from '../../src/relayer/interfaces/paymaster-client.interface';
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

describe('PrivacyPoolsBroadcaster paymaster nonce check', () => {
  const withdrawal = { bundlerUrl: 'http://bundler', entryPointAddress: `0x${'43'.repeat(20)}`, userOperation: { sender: `0x${'aa'.repeat(20)}`, nonce: '0x0' } };
  /** The sender's EntryPoint nonce is already 1, past the signed 0. */
  const makeBroadcaster = (broadcast: () => Promise<unknown>) => new PrivacyPoolsBroadcaster({
    host: { provider: { request: async () => toHex(1n, { size: 32 }) } } as never,
    broadcasterUrl: 'http://mock.relayer',
    relayerClientFactory: () => ({} as never),
    paymasterClientFactory: () => ({ broadcast }) as never,
  });

  it('reports staleNonce when the bundler refuses a withdrawal whose sender nonce moved', async () => {
    const broadcaster = makeBroadcaster(async () => { throw new PaymasterBroadcastError('not-accepted', 'Bundler error -32602.'); });
    const error = await broadcaster.broadcast({ mode: 'paymaster', withdrawal } as never).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(PaymasterBroadcastError);
    expect(error).toMatchObject({ staleNonce: { kind: 'entry-point', signed: 0n, current: 1n } });
    expect((error as Error).message).toContain('sync before preparing another withdrawal');
  });

  it('still resolves a rebroadcast of a withdrawal that landed, which moved the nonce', async () => {
    const broadcaster = makeBroadcaster(async () => [{ userOpHash: `0x${'cc'.repeat(32)}`, wait: async () => ({}) }]);

    await expect(broadcaster.broadcast({ mode: 'paymaster', withdrawal } as never)).resolves.toMatchObject({ requestId: `0x${'cc'.repeat(32)}` });
  });
});

export type PPv1RelayerQuoteFailure = {
  relayerId: string;
  relayerUrl: string;
  message: string;
} & (
  | { reason: 'fee-too-high'; requiredFeeBPS: bigint; maxRelayFeeBPS: bigint }
  | { reason: 'quote-failed' }
);

/** No relayer supplied a usable quote. Fees are in basis points. */
export class PPv1RelayerQuoteError extends Error {
  constructor(readonly failures: readonly PPv1RelayerQuoteFailure[]) {
    super(failures.length === 0 ? 'No relayers configured' :
      `All relayers failed to provide a quote: ${failures.map(failure => `${failure.relayerId}: ${failure.message}`).join('; ')}`);
    this.name = 'PPv1RelayerQuoteError';
  }
}

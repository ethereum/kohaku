import { PluginError } from "@kohaku-eth/plugins";

/** The pool moved on between building a proof and sending it: prepare the operation again. */
export class TacitStaleProofError extends PluginError {
  constructor(detail = "another transaction reached the pool first") {
    super(`The proof is stale (${detail}); prepare the operation again.`);
  }
}

/** The relayer's fee is above what the caller allowed, or has gone up since the quote. */
export class TacitFeeError extends PluginError {
  constructor(
    readonly quoted: bigint,
    readonly limit: bigint,
  ) {
    super(`The relayer fee ${quoted} is above the limit ${limit}.`);
  }
}

/** The relayer refused or failed a request. */
export class TacitRelayerError extends PluginError {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The balance is enough but sits in more notes than one transaction can spend: consolidate first. */
export class TacitFragmentedBalanceError extends PluginError {
  constructor(
    readonly required: bigint,
    readonly available: bigint,
  ) {
    super(`The balance (${available}) covers ${required} only across more than two notes; consolidate first.`);
  }
}

import type { METHOD_ZKPASSPORT_CUSTOM_DATA_KEY, METHOD_ZKPASSPORT_REQUEST_MODE } from '../constants';
import type { Hex } from '../interfaces';

/** The config record: the committed identifier and the service its proofs are scoped to. */
export type ZkPassportConfig = {
  readonly uniqueIdentifier: Hex;
  readonly domain: string;
  readonly scope: string;
  readonly validityPeriodInSeconds: bigint;
};

/** The upstream `ProofVerificationData`, in its upstream member order. */
export type ZkPassportProofVerificationData = {
  readonly vkeyHash: Hex;
  readonly proof: Hex;
  readonly publicInputs: readonly Hex[];
};

/** The proof the request delivers. */
export type ZkPassportProof = {
  readonly proofVerificationData: ZkPassportProofVerificationData;
  readonly committedInputs: Hex;
};

/** The integrator's parameters as this method keeps them on its input records. */
export type ZkPassportSession = {
  readonly domain: string;
  readonly scope: string;
  readonly name?: string;
  readonly logo?: string;
  readonly purpose?: string;
};

/** One proof as the stack's `ProofResult` carries it; only the members this method reads. */
export type ZkPassportStackProof = {
  readonly name?: string;
  readonly committedInputs?: { readonly [circuit: string]: unknown };
  readonly [member: string]: unknown;
};

/** The request arguments the method passes, and no other. */
export type ZkPassportRequestArgs = {
  readonly name?: string;
  readonly logo?: string;
  readonly purpose?: string;
  readonly scope: string;
  readonly mode: typeof METHOD_ZKPASSPORT_REQUEST_MODE;
  readonly devMode: boolean;
};

/** The request result the page renders and listens on. */
export type ZkPassportRequest = {
  readonly url: string;
  readonly requestId: string;
  onRequestReceived(callback: () => void): void;
  onGeneratingProof(callback: () => void): void;
  onProofGenerated(callback: (proof: ZkPassportStackProof) => void): void;
  onSuccess(callback: (response: { proofs: ZkPassportStackProof[]; result: unknown }) => unknown): void;
  onReject(callback: () => void): void;
  onError(callback: (error: string) => void): void;
  /** @deprecated The verified flag can be tampered with in the browser; verify the proofs with `verify()` instead. */
  onResult(
    callback: (response: { verified: boolean; uniqueIdentifier: string | undefined; proofs: ZkPassportStackProof[]; [member: string]: unknown }) => unknown,
  ): void;
  onBridgeConnect(callback: () => void): void;
  onBridgeConnectionLost(callback: () => void): void;
  /** Closes this request through the client's `cancelRequest(requestId)`. */
  cancel(): void;
};

/** The part of the stack's query builder this method calls. */
export type ZkPassportQueryBuilder = {
  bind(key: typeof METHOD_ZKPASSPORT_CUSTOM_DATA_KEY, value: string): ZkPassportQueryBuilder;
  done(): Omit<ZkPassportRequest, 'cancel'>;
};

/** The verifier parameters as the stack returns them (its `SolidityVerifierParameters`). */
export type ZkPassportVerifierParameters = {
  /**
   * The version word, the encoding `zkPassportVersionWord` returns; compare it with `trustedKeys[METHOD_ZKPASSPORT_VERSION_KEY]`
   * by value (`BigInt` equality), since the module's `verify` routes every proof by that word.
   */
  readonly version: string;
  readonly proofVerificationData: {
    readonly vkeyHash: string;
    readonly proof: string;
    readonly publicInputs: readonly string[];
  };
  readonly committedInputs: string;
  readonly serviceConfig: {
    readonly validityPeriodInSeconds: number;
    readonly domain: string;
    readonly scope: string;
    readonly devMode: boolean;
  };
};

/** One `@zkpassport/sdk` 0.17.1 `ZKPassport` instance, bound to one domain; declared here so the package's types never import the optional peer. */
export type ZkPassportClient = {
  request(args: ZkPassportRequestArgs): Promise<ZkPassportQueryBuilder>;
  getSolidityVerifierParameters(args: {
    proof: ZkPassportStackProof;
    scope: string;
    domain: string;
    devMode: boolean;
  }): ZkPassportVerifierParameters;
  cancelRequest(requestId: string): void;
};

/** The stack's constructor, `new ZKPassport(domain)`, as an injectable function. */
export type ZkPassportStack = (domain: string) => ZkPassportClient | Promise<ZkPassportClient>;

/** The zkPassport method's options. */
export type ZkPassportMethodOptions = {
  /** Replaces `new ZKPassport(domain)`; by default the installed `@zkpassport/sdk` is imported on first use. */
  readonly stack?: ZkPassportStack;
  /**
   * Opens dev-mode requests and accepts the app's fake-passport proofs locally; off by default.
   * The deployed module verifies with dev mode off and refuses any nullifier type but zero, so such a reply is rejected on chain.
   */
  readonly devMode?: boolean;
};

import type { METHOD_ZKPASSPORT_CUSTOM_DATA_KEY, METHOD_ZKPASSPORT_DEV_MODE, METHOD_ZKPASSPORT_REQUEST_MODE } from '../constants';
import type { Hex } from '../interfaces';

/** The config record the commitment closes over. */
export type ZkPassportConfig = {
  readonly uniqueIdentifier: Hex;
  readonly version: Hex;
  readonly domain: string;
  readonly scope: string;
  readonly validityPeriodInSeconds: bigint;
};

/** The upstream `ProofVerificationData`, in its upstream member order. */
export type ProofVerificationData = {
  readonly vkeyHash: Hex;
  readonly proof: Hex;
  readonly publicInputs: readonly Hex[];
};

/** The proof the request delivers. */
export type ZkPassportProof = {
  readonly proofVerificationData: ProofVerificationData;
  readonly committedInputs: Hex;
};

/** The integrator's parameters as this method keeps them on its input records. */
export type Session = {
  readonly domain: string;
  readonly scope: string;
  readonly name?: string;
  readonly logo?: string;
  readonly purpose?: string;
};

/** One proof as the stack's `ProofResult` carries it; only the members this method reads. */
export type StackProof = {
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
  readonly devMode: typeof METHOD_ZKPASSPORT_DEV_MODE;
};

/** The request result the page renders and listens on. */
export type ZkPassportRequest = {
  readonly url: string;
  readonly requestId: string;
  onRequestReceived(callback: () => void): void;
  onGeneratingProof(callback: () => void): void;
  onProofGenerated(callback: (proof: StackProof) => void): void;
  onSuccess(callback: (response: { proofs: StackProof[]; result: unknown }) => unknown): void;
  onReject(callback: () => void): void;
  onError(callback: (error: string) => void): void;
};

/** The part of the stack's query builder this method calls. */
export type ZkPassportQueryBuilder = {
  bind(key: typeof METHOD_ZKPASSPORT_CUSTOM_DATA_KEY, value: string): ZkPassportQueryBuilder;
  done(): ZkPassportRequest;
};

/** The verifier parameters as the stack returns them (its `SolidityVerifierParameters`). */
export type ZkPassportVerifierParameters = {
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
    proof: StackProof;
    scope: string;
    domain: string;
    devMode: typeof METHOD_ZKPASSPORT_DEV_MODE;
  }): ZkPassportVerifierParameters;
};

/** The stack's constructor, `new ZKPassport(domain)`, as an injectable function. */
export type ZkPassportStack = (domain: string) => ZkPassportClient | Promise<ZkPassportClient>;

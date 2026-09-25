import type { Address, Hex } from './chain';
import type { ApproverRequest } from './gathering';
import type { PaymentOrder } from './manager';

/** The EIP-712 domain built from the request's chain id, manager and digest version. */
export type TypedDataDomain = {
  readonly name: 'PolicyManager';
  readonly version: string;
  readonly chainId: number;
  readonly verifyingContract: Address;
};

/** One member of an EIP-712 struct type. */
export type TypedDataField = {
  readonly name: string;
  readonly type: string;
};

/** The `Approval` message. */
export type ApprovalMessage = {
  readonly account: Address;
  readonly action: Address;
  readonly attemptId: bigint;
  readonly setupNonce: bigint;
  readonly setupBodyHash: Hex;
  readonly payload: Hex;
  readonly order: PaymentOrder;
  readonly validUntil: number;
  readonly place: number;
};

/** The `Cancellation` message. */
export type CancellationMessage = {
  readonly account: Address;
  readonly action: Address;
  readonly attemptId: bigint;
  readonly setupNonce: bigint;
  readonly setupBodyHash: Hex;
  readonly validUntil: number;
  readonly place: number;
};

/** The typed data for one place, as a wallet's signing call takes it. */
export type TypedData = {
  readonly domain: TypedDataDomain;
  readonly types: { readonly [struct: string]: readonly TypedDataField[] };
} & (
  | { readonly primaryType: 'Approval'; readonly message: ApprovalMessage }
  | { readonly primaryType: 'Cancellation'; readonly message: CancellationMessage }
);

/** The per-place context the orchestrator builds and hands to a method. */
export type Ctx = {
  readonly request: ApproverRequest;
  readonly place: number;
  readonly digest: Hex;
  readonly typedData: TypedData;
};

/** A method's own parameters for one ceremony or one signing input. */
export type Params = { readonly [name: string]: unknown };

/** What a method needs before anything acts, the implementation's own type. */
export type Input = { readonly [name: string]: unknown };

/**
 * What an enrollment ceremony needs, or nothing to perform when the integrator already holds the config.
 * Both carry the method's own data, which `configFrom` reads back.
 */
export type EnrollInput =
  | { readonly kind: 'nothing-to-perform'; readonly [name: string]: unknown }
  | { readonly kind: 'ceremony'; readonly [name: string]: unknown };

/** What the device or the ceremony produced, the implementation's own shape, or none. */
export type Material = { readonly [name: string]: unknown } | undefined;

/** Why a reply could not be produced. */
export const REPLY_FAILURE_CAUSES = [
  'device-refused',
  'device-unavailable',
  'material-rejected',
  'method-unsupported',
  'request-unsupported',
] as const;

export type ReplyFailureCause = (typeof REPLY_FAILURE_CAUSES)[number];

/** A typed failure naming its cause, never a thrown error. */
export type ReplyFailure = {
  readonly kind: 'reply-failure';
  readonly cause: ReplyFailureCause;
};

/** An enrollment failure, the same type as a reply failure. */
export type EnrollFailure = ReplyFailure;

/** A method's local verdict on a proof. */
export const VERDICTS = ['satisfied', 'rejected', 'not-judged'] as const;

export type Verdict = (typeof VERDICTS)[number];

/** Where the approver's device has to be. */
export const DEVICE_BINDINGS = ['none', 'browser-authenticator', 'external-app', 'in-browser-prover'] as const;

export type DeviceBinding = (typeof DEVICE_BINDINGS)[number];

/** The device kind every implementation states. */
export const DEVICE_KINDS = [
  'typed-data-wallet',
  'webauthn-authenticator',
  'external-proving-app',
  'in-page-prover',
] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Facts about the approver's device, values and never a judgment. */
export type DeviceFacts = {
  readonly kind: DeviceKind;
  readonly [fact: string]: unknown;
};

/** One decoded value of a method's config or proof layout. */
export type FieldValue = bigint | number | boolean | string | readonly FieldValue[] | Fields;

/** A method's config or proof fields by name, in the method's own layout. */
export type Fields = { readonly [name: string]: FieldValue };

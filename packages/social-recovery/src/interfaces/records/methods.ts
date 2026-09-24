// The records of the approving and enrolling side (D-206). What differs per
// method is typed as the implementation's own open record (l.1221, l.1245).
// Line numbers are design/offchain/sdk.md.
import type { Address, Hex } from './chain';
import type { ApproverRequest } from './gathering';
import type { PaymentOrder } from './manager';

/** The domain the request's chain id, manager and digest version build, under the name `PolicyManager` (D-206 l.1213). */
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

/** The `Approval` message (D-204 l.874, contracts.md l.199-203). */
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

/** The `Cancellation` message, no payload and no order (D-204 l.874, contracts.md l.205-208). */
export type CancellationMessage = {
  readonly account: Address;
  readonly action: Address;
  readonly attemptId: bigint;
  readonly setupNonce: bigint;
  readonly setupBodyHash: Hex;
  readonly validUntil: number;
  readonly place: number;
};

/** The typed data for one place, as a wallet's signing call takes it (D-204 l.874-879). */
export type TypedData = {
  readonly domain: TypedDataDomain;
  readonly types: { readonly [struct: string]: readonly TypedDataField[] };
} & (
  | { readonly primaryType: 'Approval'; readonly message: ApprovalMessage }
  | { readonly primaryType: 'Cancellation'; readonly message: CancellationMessage }
);

/**
 * The one record four implementation members take, built by the orchestrator
 * alone: the request's members, the place, its digest and its typed data
 * (D-206 l.1229, l.1234).
 */
export type Ctx = {
  readonly request: ApproverRequest;
  readonly place: number;
  readonly digest: Hex;
  readonly typedData: TypedData;
};

/** A method's own parameters for one ceremony or one signing input (D-206 l.1220-1221). */
export type Params = { readonly [name: string]: unknown };

/** What a method needs before anything acts, the implementation's own type (D-206 l.1221). */
export type Input = { readonly [name: string]: unknown };

/**
 * What a ceremony needs, or nothing to perform for a method whose config the
 * integrator already holds (D-206 l.1220, l.1254).
 */
export type EnrollInput =
  | { readonly kind: 'nothing-to-perform' }
  | { readonly kind: 'ceremony'; readonly [name: string]: unknown };

/** What the device or the ceremony produced, the implementation's own shape, or none (D-206 l.1245, l.1255). */
export type Material = { readonly [name: string]: unknown } | undefined;

/** The five causes of a reply failure (D-206 l.1239, usage l.482). */
export const REPLY_FAILURE_CAUSES = [
  'device-refused',
  'device-unavailable',
  'material-rejected',
  'method-unsupported',
  'request-unsupported',
] as const;

export type ReplyFailureCause = (typeof REPLY_FAILURE_CAUSES)[number];

/** A typed failure naming its cause, never a thrown error (D-206 l.1239, usage l.482). */
export type ReplyFailure = {
  readonly kind: 'reply-failure';
  readonly cause: ReplyFailureCause;
};

/** The enrollment's failure: one failure type serves both sides (D-206 l.1220, l.1239). */
export type EnrollFailure = ReplyFailure;

/** The local verdict's three answers (D-206 l.1223). */
export const VERDICTS = ['satisfied', 'rejected', 'not-judged'] as const;

export type Verdict = (typeof VERDICTS)[number];

/** Where the approver's device has to be, one of four values and no other (D-206 l.1225). */
export const DEVICE_BINDINGS = ['none', 'browser-authenticator', 'external-app', 'in-browser-prover'] as const;

export type DeviceBinding = (typeof DEVICE_BINDINGS)[number];

/** The device kind every implementation states (D-205 l.1135, D-206 l.1226). */
export const DEVICE_KINDS = [
  'typed-data-wallet',
  'webauthn-authenticator',
  'external-proving-app',
  'in-page-prover',
] as const;

export type DeviceKind = (typeof DEVICE_KINDS)[number];

/** Facts about the approver's device, values and never a judgment (D-206 l.1226). */
export type DeviceFacts = {
  readonly kind: DeviceKind;
  readonly [fact: string]: unknown;
};

/** One decoded value of a method's config or proof layout. */
export type FieldValue = bigint | number | boolean | string | readonly FieldValue[] | Fields;

/** A method's config or proof fields by name, in the method's own layout (D-204 l.917). */
export type Fields = { readonly [name: string]: FieldValue };

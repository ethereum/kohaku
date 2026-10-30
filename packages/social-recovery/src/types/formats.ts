import type { FORMATS_APPROVAL_PRIMARY_TYPE, FORMATS_CANCELLATION_PRIMARY_TYPE } from '../constants';
import type { Address, Hex, PaymentOrder, ProofPlace, TypedData } from '../interfaces';

/** One clause as the body bytes carry it, its credentials as commitments rather than by method and config. */
export type BodyClause = {
  readonly threshold: number;
  readonly credentials: readonly Hex[];
};

/** The setup body the body codec encodes and decodes; `wait` is in seconds. */
export type SetupBody = {
  readonly wait: number;
  readonly ignoresPause: boolean;
  readonly clauses: readonly BodyClause[];
};

/** The request members a `Cancellation` message closes over, plus the chain id and manager its domain is built from. */
export type CancellationMembers = {
  readonly chainId: number;
  readonly manager: Address;
  readonly account: Address;
  readonly action: Address;
  readonly attemptId: bigint;
  readonly setupNonce: bigint;
  readonly setupBodyHash: Hex;
  readonly validUntil: number;
  /** The domain's version; absent where this build's `DIGEST_VERSION` applies. */
  readonly digestVersion?: string;
};

/** The request members an `Approval` message closes over, plus its domain inputs. */
export type ApprovalMembers = CancellationMembers & {
  readonly payload: Hex;
  readonly order: PaymentOrder;
};

/** The `TypedData` record narrowed to the `Approval` primary type. */
export type ApprovalTypedData = Extract<TypedData, { readonly primaryType: typeof FORMATS_APPROVAL_PRIMARY_TYPE }>;

/** The `TypedData` record narrowed to the `Cancellation` primary type. */
export type CancellationTypedData = Extract<TypedData, { readonly primaryType: typeof FORMATS_CANCELLATION_PRIMARY_TYPE }>;

/** One privilege write of the account's creation code: the storage slot and the 32-byte value stored there. */
export type CreationEntry = {
  readonly slot: Hex;
  readonly value: Hex;
};

/** The account a creation produces and the privilege writes its creation code makes, in code order. */
export type CreationPrivileges = {
  readonly account: Address;
  readonly entries: readonly CreationEntry[];
};

/** A proof place as the ABI carries it, its place a `uint256`. */
export type AbiProofPlace = Omit<ProofPlace, 'place'> & { readonly place: bigint };

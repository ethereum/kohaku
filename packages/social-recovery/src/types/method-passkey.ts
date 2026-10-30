import type { Hex } from '../interfaces';

/** The passkey method's decoded config. */
export type PasskeyConfig = {
  readonly x: bigint;
  readonly y: bigint;
  readonly rpIdHash: Hex;
};

/** The passkey method's decoded proof. */
export type PasskeyProof = {
  readonly authenticatorData: Hex;
  readonly clientDataJSON: string;
  readonly r: bigint;
  readonly s: bigint;
};

/** The key a creation's credential yields. */
export type EnrolledKey = {
  readonly x: bigint;
  readonly y: bigint;
  readonly rpIdHash: Hex;
};

/** Why an assertion fails the check list, or `ok`. */
export type AssertionCheck =
  | 'ok'
  | 'authenticator-data-short'
  | 'rp-id-hash-mismatch'
  | 'user-not-present'
  | 'user-not-verified'
  | 'client-data-prefix'
  | 'signature-out-of-range'
  | 'signature-invalid';

/** The ABI parameters of the credential commitment's preimage. */
export const FORMATS_CREDENTIAL_HASH_ABI = [{ type: 'address' }, { type: 'bytes' }, { type: 'bytes32' }] as const;

/** The ABI parameters of the setup commitment's preimage. */
export const FORMATS_SETUP_COMMITMENT_ABI = [
  { type: 'address' },
  { type: 'address' },
  { type: 'uint64' },
  { type: 'bytes' },
] as const;

/** The setup body's ABI parameters, encoded as a parameter list rather than one wrapping tuple. */
export const FORMATS_SETUP_BODY_ABI = [
  { name: 'wait', type: 'uint48' },
  { name: 'ignoresPause', type: 'bool' },
  {
    name: 'clauses',
    type: 'tuple[]',
    components: [
      { name: 'threshold', type: 'uint8' },
      { name: 'credentials', type: 'bytes32[]' },
    ],
  },
] as const;

/** The EIP-712 domain name both digests are signed under. */
export const FORMATS_DIGEST_DOMAIN_NAME = 'PolicyManager';

/** The primary type of the approval message. */
export const FORMATS_APPROVAL_PRIMARY_TYPE = 'Approval';

/** The primary type of the cancellation message. */
export const FORMATS_CANCELLATION_PRIMARY_TYPE = 'Cancellation';

/** The nested `PaymentOrder` EIP-712 struct. */
export const FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'payee', type: 'address' },
] as const;

/** The `Approval` EIP-712 types. */
export const FORMATS_APPROVAL_TYPED_DATA_TYPES = {
  Approval: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'address' },
    { name: 'attemptId', type: 'uint64' },
    { name: 'setupNonce', type: 'uint64' },
    { name: 'setupBodyHash', type: 'bytes32' },
    { name: 'payload', type: 'bytes' },
    { name: 'order', type: 'PaymentOrder' },
    { name: 'validUntil', type: 'uint48' },
    { name: 'place', type: 'uint256' },
  ],
  PaymentOrder: FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS,
} as const;

/** The `Cancellation` EIP-712 types. */
export const FORMATS_CANCELLATION_TYPED_DATA_TYPES = {
  Cancellation: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'address' },
    { name: 'attemptId', type: 'uint64' },
    { name: 'setupNonce', type: 'uint64' },
    { name: 'setupBodyHash', type: 'bytes32' },
    { name: 'validUntil', type: 'uint48' },
    { name: 'place', type: 'uint256' },
  ],
} as const;

/** The bit width of the setup body's `wait`, a duration in seconds. */
export const FORMATS_WAIT_BITS = 48;

/** The bit width of a clause's `threshold`. */
export const FORMATS_THRESHOLD_BITS = 8;

/** The bit width of the setup nonce. */
export const FORMATS_SETUP_NONCE_BITS = 64;

/** The bit width of an attempt id. */
export const FORMATS_ATTEMPT_ID_BITS = 64;

/** The bit width of a request's `validUntil` timestamp. */
export const FORMATS_VALID_UNTIL_BITS = 48;

/** The bit width of a place, carried as a safe-integer number. */
export const FORMATS_PLACE_BITS = 256;

/** The bit width of the domain's chain id, carried as a safe-integer number. */
export const FORMATS_CHAIN_ID_BITS = 256;

/** The bit width of a payment order's `amount`. */
export const FORMATS_AMOUNT_BITS = 256;

/** Whole bytes as 0x-prefixed hex, any length including zero. */
export const FORMATS_HEX_BYTES_PATTERN = /^0x(?:[0-9a-fA-F]{2})*$/;

/** Exactly 32 bytes as 0x-prefixed hex. */
export const FORMATS_HEX_BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** Exactly 20 bytes as 0x-prefixed hex. */
export const FORMATS_HEX_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** The width below which every unsigned value fits a safe integer. */
export const FORMATS_SAFE_INTEGER_BITS = 53;

import type { AbiParameter, Address, AttemptState, DescribedHandover } from '../interfaces/records';

/** The passkey method's config layout, `abi.encode(uint256 x, uint256 y, bytes32 rpIdHash)`. */
export const DESCRIPTION_PASSKEY_CONFIG_ABI = [
  { name: 'x', type: 'uint256' },
  { name: 'y', type: 'uint256' },
  { name: 'rpIdHash', type: 'bytes32' },
] as const satisfies readonly AbiParameter[];

/** The payee an order leaves open, which `executeHandover` fills with its caller. */
export const DESCRIPTION_OPEN_PAYEE: Address = '0x0000000000000000000000000000000000000000';

/** Thrown where an approver request's kind or version is not the one this build reads. */
export const DESCRIPTION_UNREAD_REQUEST_MESSAGE = 'approver request: kind or version this build does not read';

/** Thrown where an approver request's purpose is neither approval nor cancellation. */
export const DESCRIPTION_UNREAD_PURPOSE_MESSAGE = 'request.purpose must be approval or cancellation';

/** The handover of a payload whose codec threw or whose decoded keys do not encode back to its bytes. */
export const DESCRIPTION_ROUND_TRIP_FAILED: DescribedHandover = { decoded: false, cause: 'round-trip-failed' };

/** The zkPassport method's trusted-key names, one per word in the method's order. */
export const DESCRIPTION_ZKPASSPORT_KEY_NAMES = Object.freeze([
  'version',
  'rootVerifier',
  'subVerifier',
  'verifierHelper',
  'rootRegistry',
  'rootAdmin',
  'rootGuardian',
  'subVerifierAdmin',
] as const);

/** The one zkPassport trusted-key word the method accepts as zero, the root guardian. */
export const DESCRIPTION_ZKPASSPORT_OPTIONAL_KEY = 6;

/** The Aadhaar method's trusted-key names, its one word. */
export const DESCRIPTION_ISSUER_KEY_NAMES = Object.freeze(['issuerKeyHash'] as const);

/** The state a consumed attempt holds on the recovery record. */
export const DESCRIPTION_CONSUMED_ATTEMPT_STATE: AttemptState = 'Consumed';

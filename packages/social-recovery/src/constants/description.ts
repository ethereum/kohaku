import type { AbiParameter, Address, DescribedHandover } from '../interfaces/records';

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

import { encodeAbiParameters } from 'viem';
import type { Address, ApproverRequest, Hex } from '../../src/index';

/** Another canonical two-address handover than the blessed row's, so the two decode to different keys. */
export const OTHER_PAIR = {
  newAuthority: '0x6666666666666666666666666666666666666666' as Address,
  removedAuthority: '0x7777777777777777777777777777777777777777' as Address,
};

/** The canonical bytes of the other handover. */
export const OTHER_HANDOVER: Hex = encodeAbiParameters(
  [{ type: 'address' }, { type: 'address' }],
  [OTHER_PAIR.newAuthority, OTHER_PAIR.removedAuthority],
);

/** A copy of the request whose member answers `first` on its first read and `later` on every read after it. */
export function flipping(request: ApproverRequest, member: string, first: unknown, later: unknown): ApproverRequest {
  const copy = { ...request } as Record<string, unknown>;
  let reads = 0;

  Object.defineProperty(copy, member, {
    enumerable: true,
    configurable: true,
    get: () => {
      reads += 1;

      return reads === 1 ? first : later;
    },
  });

  return copy as unknown as ApproverRequest;
}

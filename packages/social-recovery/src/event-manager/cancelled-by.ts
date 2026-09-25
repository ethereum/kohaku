import { isAddressEqual, zeroAddress } from 'viem';
import type { CancelledBy } from '../interfaces';
import type { CancelFields } from '../types';

/**
 * The manager function that cancelled an attempt, derived from its `AttemptCancelled` fields.
 * Throws on a combination of fields no manager function emits.
 */
export const deriveCancelledBy = (fields: CancelFields): CancelledBy => {
  if (!isAddressEqual(fields.vetoingMethod, zeroAddress)) return 'cancelByVeto';

  if (fields.usedPlaces.length > 0) return 'cancelByProofs';

  if (isAddressEqual(fields.canceller, fields.account)) return 'cancelByOwner';

  if (isAddressEqual(fields.canceller, zeroAddress)) return 'setupWrite';

  throw new Error(
    `An AttemptCancelled log names canceller ${fields.canceller} with no vetoing method and no places, which no manager path emits.`,
  );
};

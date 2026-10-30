import { decodeAbiParameters, encodeAbiParameters, getAddress } from 'viem';
import { RECOVERY_ACTION_HANDOVER_ABI, RECOVERY_ACTION_HANDOVER_LAYOUT, RECOVERY_ACTION_ZERO_ADDRESS } from '../constants';
import { assertArray, assertObject, normalizeAddress, sameAddress } from '../formats/guards';
import { decodeStrictly } from '../formats/strict';
import type { Address, Handover, Hex, IActionCodec } from '../interfaces';

/** The two words of the layout, with no judgment of the addresses they hold. */
const encodeLayout = (handover: Required<Handover>): Hex =>
  encodeAbiParameters(RECOVERY_ACTION_HANDOVER_ABI, [handover.newAuthority, handover.removedAuthority]);

/** The served action addresses checksummed, refusing an empty list and an address listed twice. */
function servedActions(actions: readonly Address[]): readonly Address[] {
  assertArray(actions, 'actions');

  if (actions.length === 0) throw new RangeError('actions must name at least one action address');

  const served = actions.map((action, index) => normalizeAddress(action, `actions[${index}]`));

  if (new Set(served).size !== served.length) throw new RangeError('actions must not name an action address twice');

  return Object.freeze(served);
}

/** The codec of the Ambire recovery action's payload, `abi.encode(Handover)`. */
export class AmbireActionCodec implements IActionCodec {
  readonly actions: readonly Address[];

  constructor(actions: readonly Address[]) {
    this.actions = servedActions(actions);
  }

  /** Refuses a missing removed authority, a zero address on either side and one address on both, as the action does. */
  encode(handover: Handover): Hex {
    assertObject(handover, 'handover');

    const newAuthority = normalizeAddress(handover.newAuthority, 'handover.newAuthority');

    if (handover.removedAuthority === undefined) throw new TypeError('handover.removedAuthority is required');

    const removedAuthority = normalizeAddress(handover.removedAuthority, 'handover.removedAuthority');

    if (sameAddress(newAuthority, RECOVERY_ACTION_ZERO_ADDRESS) || sameAddress(removedAuthority, RECOVERY_ACTION_ZERO_ADDRESS)) {
      throw new RangeError('handover must name no zero address');
    }

    if (sameAddress(newAuthority, removedAuthority)) {
      throw new RangeError('handover must name two different addresses');
    }

    return encodeLayout({ newAuthority, removedAuthority });
  }

  /**
   * Refuses bytes that are not exactly the layout's two canonical words, trailing bytes among them.
   * Judges the layout alone: a zero address or one address on both sides decodes, and `encode` refuses it.
   */
  decode(payload: Hex): Handover {
    return decodeStrictly(payload, 'payload', RECOVERY_ACTION_HANDOVER_LAYOUT, {
      decode: (bytes) => decodeAbiParameters(RECOVERY_ACTION_HANDOVER_ABI, bytes),
      build: ([newAuthority, removedAuthority]) => ({
        newAuthority: getAddress(newAuthority),
        removedAuthority: getAddress(removedAuthority),
      }),
      encode: encodeLayout,
    });
  }
}

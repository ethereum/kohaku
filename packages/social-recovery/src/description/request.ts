import { DESCRIPTION_OPEN_PAYEE, DESCRIPTION_ROUND_TRIP_FAILED } from '../constants';
import { normalizeAddress } from '../formats/guards';
import type {
  ApproverRequest,
  DescribedHandover,
  DescribedOrder,
  Hex,
  IActionCodec,
  PaymentOrder,
  RequestDescription,
} from '../interfaces';
import type { ActionCodecRegistry, MethodRegistry } from '../types';
import { checkedRequest } from './ctx';
import { entryFor } from './lookup';

/** The handover the codec decodes, kept only where encoding it again gives back the payload's own bytes. */
function describedHandover(payload: Hex, codec: IActionCodec | undefined): DescribedHandover {
  if (codec === undefined) return { decoded: false, cause: 'no-codec' };

  try {
    const handover = codec.decode(payload);

    if (handover.removedAuthority === undefined) return DESCRIPTION_ROUND_TRIP_FAILED;

    if (codec.encode(handover).toLowerCase() !== payload.toLowerCase()) return DESCRIPTION_ROUND_TRIP_FAILED;

    return {
      decoded: true,
      newAuthority: normalizeAddress(handover.newAuthority, 'handover.newAuthority'),
      removedAuthority: normalizeAddress(handover.removedAuthority, 'handover.removedAuthority'),
    };
  } catch {
    return DESCRIPTION_ROUND_TRIP_FAILED;
  }
}

const describedOrder = (order: PaymentOrder): DescribedOrder => ({
  token: order.token,
  amount: order.amount,
  payee: order.payee.toLowerCase() === DESCRIPTION_OPEN_PAYEE ? 'open' : order.payee,
});

/**
 * What an approver reads before producing a proof, from the request and the two registries with no chain read.
 * Throws a TypeError or RangeError on a request this build does not read or whose members are malformed.
 */
export function describeRequest(
  request: ApproverRequest,
  codecs: ActionCodecRegistry,
  methods: MethodRegistry,
): RequestDescription {
  const { ctx, members, order } = checkedRequest(request);
  const checked = ctx.request;
  const { method, config } = checked;
  const implementation = entryFor(methods, method);
  const shared = {
    account: members.account,
    chainId: members.chainId,
    manager: members.manager,
    action: members.action,
    attemptId: members.attemptId,
    setupNonce: members.setupNonce,
    purpose: checked.purpose,
    validUntil: members.validUntil,
    place: ctx.place,
    identityPublic: { method, config, saltPublished: true },
    device: implementation === undefined ? 'no-implementation' : implementation.describe(ctx),
  } as const;

  if (checked.purpose === 'cancellation' || order === undefined) return shared;

  return {
    ...shared,
    handover: describedHandover(checked.payload, entryFor(codecs, members.action)),
    order: describedOrder(order),
  };
}

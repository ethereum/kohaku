import { FORMATS_VALID_UNTIL_BITS } from '../constants';
import { assertPassword } from '../encryption/cipher';
import { checkedPaymentOrder } from '../formats/payment-order';
import { assertObject, assertUintNumber, normalizeAddress } from '../formats/guards';
import type {
  ClientConfiguration,
  ConfigurationSource,
  Handover,
  PaymentOrder,
  SerializedPaymentOrder,
  ValidityWindow,
} from '../interfaces';

/** The handover with its addresses checksummed, refusing a malformed one; the removed key stays absent where it was left out. */
export function checkedHandover(handover: Handover): Handover {
  assertObject(handover, 'handover');

  const newAuthority = normalizeAddress(handover.newAuthority, 'handover.newAuthority');

  if (handover.removedAuthority === undefined) return { newAuthority };

  return { newAuthority, removedAuthority: normalizeAddress(handover.removedAuthority, 'handover.removedAuthority') };
}

/** The order as the record stores it, its amount a decimal string, refusing a malformed order. */
export function serializedOrder(order: PaymentOrder): SerializedPaymentOrder {
  const checked = checkedPaymentOrder(order, 'order');

  return { token: checked.token, amount: checked.amount.toString(), payee: checked.payee };
}

/** Refuses a source that is not an object, or a password that is not a well-formed string; the restore checks a configuration's shape. */
export function assertSource(source: ConfigurationSource): void {
  assertObject(source, 'source');

  if ('password' in source) assertPassword(source.password);
}

/** The window's width in seconds, refusing a non-integer with a `TypeError` and a zero width or one past `uint48` with a `RangeError`. */
export function windowWidth(window: ValidityWindow): number {
  assertObject(window, 'window');
  assertUintNumber(window.window, FORMATS_VALID_UNTIL_BITS, 'window.window');

  if (window.window === 0) throw new RangeError('window.window must be at least one second');

  return window.window;
}

/** A cancel gathering's window width, refusing one longer than the cancel gathering's own duration with a `RangeError`. */
export function cancellingWindow(window: ValidityWindow, configuration: ClientConfiguration): number {
  const width = windowWidth(window);

  if (width > configuration.cancelWindow) {
    throw new RangeError(`window.window ${width} is longer than configuration.cancelWindow ${configuration.cancelWindow}`);
  }

  return width;
}

/** The deadline a window sets from the pinned block's timestamp, refusing one past `uint48` with a `RangeError`. */
export function windowEnd(timestamp: number, width: number): number {
  const end = timestamp + width;

  if (end >= 2 ** FORMATS_VALID_UNTIL_BITS) throw new RangeError(`the window ends at ${end}, past uint${FORMATS_VALID_UNTIL_BITS}`);

  return end;
}

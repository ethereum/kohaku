import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { FORMATS_AMOUNT_BITS, FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS } from '../constants';
import type { Hex, PaymentOrder } from '../interfaces';
import { assertObject, assertUintBigint, normalizeAddress } from './guards';
import { decodeStrictly } from './strict';

/** A checked copy of a payment order, its addresses checksummed. */
export function checkedPaymentOrder(order: PaymentOrder, name: string): PaymentOrder {
  assertObject(order, name);

  const token = normalizeAddress(order.token, `${name}.token`);

  assertUintBigint(order.amount, FORMATS_AMOUNT_BITS, `${name}.amount`);

  return { token, amount: order.amount, payee: normalizeAddress(order.payee, `${name}.payee`) };
}

/** Encodes a payment order as its three static words rather than one wrapping tuple; a zero amount and a zero payee are accepted. */
export function encodePaymentOrder(order: PaymentOrder): Hex {
  const checked = checkedPaymentOrder(order, 'order');

  return encodeAbiParameters(FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS, [checked.token, checked.amount, checked.payee]);
}

/** Decodes a payment order, refusing bytes its encoder would not reproduce, trailing bytes among them. */
export function decodePaymentOrder(encoded: Hex): PaymentOrder {
  return decodeStrictly(encoded, 'order', '(address, uint256, address)', {
    decode: (bytes) => decodeAbiParameters(FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS, bytes),
    build: ([token, amount, payee]) => checkedPaymentOrder({ token, amount, payee }, 'order'),
    encode: encodePaymentOrder,
  });
}

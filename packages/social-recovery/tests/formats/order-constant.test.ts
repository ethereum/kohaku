import { describe, expect, it } from 'vitest';
import * as sdk from '../../src/index';

const ORDER_FIELDS = [
  { name: 'token', type: 'address' },
  { name: 'amount', type: 'uint256' },
  { name: 'payee', type: 'address' },
];

describe('the payment order struct is one constant', () => {
  it('no longer exports the duplicate components or their bare alias', () => {
    expect('FORMATS_PAYMENT_ORDER_COMPONENTS' in sdk).toBe(false);
    expect('FORMATS_PAYMENT_ORDER_ABI' in sdk).toBe(false);
  });

  it('keeps the typed-data name with the three members in their on-chain order', () => {
    expect(sdk.FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS).toStrictEqual(ORDER_FIELDS);
  });

  it('is the very object the approval typed data and the startAttempt order tuple use', () => {
    const request = sdk.FORMATS_START_ATTEMPT_ABI[0].inputs[0].components;
    const order = request.find((member) => member.name === 'order');

    expect(sdk.FORMATS_APPROVAL_TYPED_DATA_TYPES.PaymentOrder).toBe(sdk.FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS);
    expect(order && 'components' in order ? order.components : undefined).toBe(sdk.FORMATS_PAYMENT_ORDER_TYPED_DATA_FIELDS);
  });
});

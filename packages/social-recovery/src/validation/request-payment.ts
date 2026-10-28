import { zeroAddress } from 'viem';
import { VALIDATION_UNKNOWN_TOKEN_SHAPES } from '../constants';
import type { PaymentOrder } from '../interfaces';
import type { Findings, RequestValidationContext } from '../types/validation';
import { addWarning, normalizeAddresses } from './common';

/** The payment warnings an opening order with a nonzero amount reaches; a zero amount pays nobody and reaches none. */
export function paymentFindings(order: PaymentOrder, context: RequestValidationContext, findings: Findings): void {
  const { token, amount, payee } = order;

  if (amount === 0n) return;

  const balance = context.balance as bigint;
  const allowlist = normalizeAddresses(context.configuration.tokens, 'context.configuration.tokens');

  if (amount > balance) addWarning(findings, 'payment.insufficient', 'payment', { token, amount, balance });

  if (payee === zeroAddress) addWarning(findings, 'payment.open-payee', 'payment', { payee, sponsorRepaid: false });

  if (!allowlist.includes(token)) {
    addWarning(findings, 'payment.token-unknown', 'payment', { token, allowlist, shapes: [...VALIDATION_UNKNOWN_TOKEN_SHAPES] });
  }

  addWarning(findings, 'payment.sponsor-sees', 'request', { cleartext: true });
}

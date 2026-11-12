import { describe, expect, it } from 'vitest';
import { validateRequest, windowFindings, type AttemptRequest, type CancelRequest, type RequestValidationContext } from '../../src/index';
import {
  CANCEL,
  CANCEL_CONTEXT,
  CONFIGURATION,
  ECDSA,
  OPENING,
  OTHER_TOKEN,
  PASSKEY,
  REQUEST_CONTEXT,
  T,
  TOKEN,
  ZERO,
  findingsOf,
} from './fixtures';

const SPONSOR_SEES = { code: 'payment.sponsor-sees', subject: 'request', values: { cleartext: true } };

const warningCodes = (request: AttemptRequest | CancelRequest = OPENING, context: RequestValidationContext = REQUEST_CONTEXT): string[] =>
  validateRequest(request, context).warnings.map((finding) => finding.code);

const withOrder = (order: Partial<AttemptRequest['order']>): AttemptRequest => ({ ...OPENING, order: { ...OPENING.order, ...order } });

describe('validateRequest warnings', () => {
  it('raises only payment.sponsor-sees on the healthy paying opening, and nothing on the healthy cancellation', () => {
    expect(validateRequest(OPENING, REQUEST_CONTEXT).warnings).toEqual([SPONSOR_SEES]);
    expect(warningCodes(CANCEL, CANCEL_CONTEXT)).toEqual([]);
  });

  it('raises payment.insufficient when the balance is one under the amount, and not at the amount', () => {
    expect(findingsOf(validateRequest(OPENING, { ...REQUEST_CONTEXT, balance: 999n }), 'payment.insufficient')).toEqual([
      { code: 'payment.insufficient', subject: 'payment', values: { token: TOKEN, amount: 1_000n, balance: 999n } },
    ]);
    expect(warningCodes()).not.toContain('payment.insufficient');
  });

  it('raises payment.open-payee for a zero payee on a paying order, and not for a named payee', () => {
    expect(findingsOf(validateRequest(withOrder({ payee: ZERO }), REQUEST_CONTEXT), 'payment.open-payee')).toEqual([
      { code: 'payment.open-payee', subject: 'payment', values: { payee: ZERO, sponsorRepaid: false } },
    ]);
    expect(warningCodes()).not.toContain('payment.open-payee');
  });

  it('raises payment.token-unknown with the allowlist and the three silent shapes, and not for a listed token', () => {
    expect(findingsOf(validateRequest(withOrder({ token: OTHER_TOKEN }), REQUEST_CONTEXT), 'payment.token-unknown')).toEqual([
      {
        code: 'payment.token-unknown',
        subject: 'payment',
        values: { token: OTHER_TOKEN, allowlist: [TOKEN], shapes: ['returns-false', 'no-code', 'accepting-fallback'] },
      },
    ]);
    expect(warningCodes()).not.toContain('payment.token-unknown');
  });

  it('raises no payment warning on a zero amount however the order looks', () => {
    const order = withOrder({ amount: 0n, payee: ZERO, token: OTHER_TOKEN });

    expect(warningCodes(order, { ...REQUEST_CONTEXT, balance: 0n })).toEqual([]);
  });

  it('raises no payment warning on a cancellation', () => {
    expect(warningCodes(CANCEL, { ...CANCEL_CONTEXT, balance: 0n })).toEqual([]);
  });

  it('raises method.unshipped once, naming the methods no implementation in this build serves', () => {
    expect(findingsOf(validateRequest(OPENING, { ...REQUEST_CONTEXT, implementedMethods: [ECDSA] }), 'method.unshipped')).toEqual([
      { code: 'method.unshipped', subject: 'request', values: { methods: [PASSKEY] } },
    ]);
    expect(warningCodes()).not.toContain('method.unshipped');
  });

  it('never raises request.window-short, even with a width under the floor', () => {
    const narrow = { ...REQUEST_CONTEXT, configuration: { ...CONFIGURATION, requestWindow: { default: 600, floor: 300, ceiling: 259_200 } } };

    expect(warningCodes({ ...OPENING, validUntil: T + 299 }, narrow)).toEqual(['payment.sponsor-sees']);
    expect(warningCodes({ ...OPENING, validUntil: T + 3_599 })).toEqual(['payment.sponsor-sees']);
    expect(warningCodes({ ...CANCEL, validUntil: T + 1 }, CANCEL_CONTEXT)).toEqual([]);
  });

  it('leaves request.window-short to windowFindings, which raises it for the gathering', () => {
    expect(windowFindings({ validUntil: T + 3_599, blockTimestamp: T }, T, CONFIGURATION.requestWindow).warnings).toEqual([
      { code: 'request.window-short', subject: 'request', values: { window: 3_599, floor: 3_600 } },
    ]);
  });

  it('raises request.moment-skew past fifteen minutes from the block time, and not at fifteen minutes', () => {
    expect(findingsOf(validateRequest(OPENING, { ...REQUEST_CONTEXT, moment: T - 901 }), 'request.moment-skew')).toEqual([
      { code: 'request.moment-skew', subject: 'request', values: { moment: T - 901, blockTimestamp: T, span: 900 } },
    ]);
    expect(warningCodes(OPENING, { ...REQUEST_CONTEXT, moment: T + 900 })).toEqual(['payment.sponsor-sees']);
  });

  it('never raises cancel.window-late, which windowFindings raises for the cancel gathering', () => {
    const request = { ...CANCEL, validUntil: T + 172_801 };

    expect(warningCodes(request, CANCEL_CONTEXT)).toEqual([]);
    expect(
      windowFindings({ validUntil: T + 172_801, blockTimestamp: T, consumableAfter: T + 172_800 }, T, CONFIGURATION.requestWindow).warnings,
    ).toEqual([{ code: 'cancel.window-late', subject: 'request', values: { validUntil: T + 172_801, consumableAfter: T + 172_800 } }]);
  });

  it('raises payment.sponsor-sees on a paying opening alone', () => {
    expect(findingsOf(validateRequest(OPENING, REQUEST_CONTEXT), 'payment.sponsor-sees')).toEqual([SPONSOR_SEES]);
    expect(warningCodes(withOrder({ amount: 0n }))).toEqual([]);
  });
});

const WIDE = { code: 'request.window-wide', subject: 'request', values: { window: 259_201, ceiling: 259_200 } };

const KINDS: readonly [string, AttemptRequest | CancelRequest, RequestValidationContext][] = [
  ['an opening', OPENING, REQUEST_CONTEXT],
  ['a cancellation', CANCEL, CANCEL_CONTEXT],
];

describe('validateRequest: the window ceiling', () => {
  it.each(KINDS)('raises request.window-wide on %s one second over the ceiling and not at it', (_kind, request, context) => {
    expect(findingsOf(validateRequest({ ...request, validUntil: T + 259_201 }, context), 'request.window-wide')).toEqual([WIDE]);
    expect(findingsOf(validateRequest({ ...request, validUntil: T + 259_200 }, context), 'request.window-wide')).toEqual([]);
  });

  it('warns without refusing: a wide opening raises no error, the warning ahead of the payment ones', () => {
    const result = validateRequest({ ...OPENING, validUntil: T + 400_000 }, REQUEST_CONTEXT);

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([{ ...WIDE, values: { window: 400_000, ceiling: 259_200 } }, SPONSOR_SEES]);
  });

  it('measures the width left from the pinned block, so a window wide at one block is not a second later', () => {
    const request = { ...OPENING, validUntil: T + 259_201 };
    const later = { ...REQUEST_CONTEXT, block: { ...REQUEST_CONTEXT.block, timestamp: T + 1 }, moment: T + 1 };

    expect(findingsOf(validateRequest(request, REQUEST_CONTEXT), 'request.window-wide')).toEqual([WIDE]);
    expect(findingsOf(validateRequest(request, later), 'request.window-wide')).toEqual([]);
  });

  it('reads the ceiling from the context configuration', () => {
    const tight = { ...REQUEST_CONTEXT, configuration: { ...CONFIGURATION, requestWindow: { ...CONFIGURATION.requestWindow, ceiling: 7_200 } } };

    expect(findingsOf(validateRequest({ ...OPENING, validUntil: T + 7_201 }, tight), 'request.window-wide')).toEqual([
      { code: 'request.window-wide', subject: 'request', values: { window: 7_201, ceiling: 7_200 } },
    ]);
  });

  it.each<[string, Record<string, unknown>, typeof TypeError | typeof RangeError]>([
    ['without a ceiling', { default: 86_400, floor: 3_600 }, TypeError],
    ['with a fractional ceiling', { ...CONFIGURATION.requestWindow, ceiling: 1.5 }, TypeError],
    ['with a negative ceiling', { ...CONFIGURATION.requestWindow, ceiling: -1 }, RangeError],
  ])('throws naming context.configuration.requestWindow.ceiling for a window %s, on both kinds, never a finding', (_name, requestWindow, kind) => {
    for (const [, request, context] of KINDS) {
      const judge = () => validateRequest(request, { ...context, configuration: { ...CONFIGURATION, requestWindow } as unknown as typeof CONFIGURATION });

      expect(judge).toThrow(kind);
      expect(judge).toThrow('context.configuration.requestWindow.ceiling');
    }
  });
});

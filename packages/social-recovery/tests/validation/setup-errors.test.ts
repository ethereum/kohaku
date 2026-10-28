import { describe, expect, it } from 'vitest';
import { BACKUP_PADDING_SIZE, validateSetup, type Credential, type Hex } from '../../src/index';
import { referenceSize } from '../encryption/reference';
import {
  ACCOUNT,
  ACTION,
  CONFIGURATION,
  DRAFT,
  ECDSA,
  OTHER_IMPLEMENTATION,
  PASSKEY,
  SALT,
  SERVED_IMPLEMENTATION,
  SETUP_CONTEXT,
  T,
  credential,
  findingsOf,
  withClauses,
} from './fixtures';

const UINT48_MAX = 2 ** 48 - 1;

/** A passkey-width config, 96 bytes, distinct per number. */
const wideConfig = (n: number): Hex => `0x${n.toString(16).padStart(192, '0')}`;

/** One 1-of-1 clause per credential, each a passkey-width config with a supplied salt. */
const widestClauses = (count: number) =>
  Array.from({ length: count }, (_, n) => ({
    threshold: 1,
    credentials: [{ method: PASSKEY, config: wideConfig(n + 1), salt: SALT }],
  }));

/** Alternating ECDSA and passkey credentials with distinct configs. */
const many = (count: number): Credential[] =>
  Array.from({ length: count }, (_, n) => credential(n % 2 === 0 ? ECDSA : PASSKEY, n + 1));

const errorCodes = (draft = DRAFT, context = SETUP_CONTEXT): string[] =>
  validateSetup(draft, context).errors.map((finding) => finding.code);

describe('validateSetup errors', () => {
  it('raises nothing on the healthy draft', () => {
    expect(validateSetup(DRAFT, SETUP_CONTEXT)).toEqual({ errors: [], warnings: [] });
  });

  it('raises rule.empty on a draft with no clauses, and not on one clause', () => {
    expect(validateSetup(withClauses([]), SETUP_CONTEXT).errors).toEqual([
      { code: 'rule.empty', subject: 'setup', values: { clauses: 0 } },
    ]);
    expect(errorCodes(withClauses([{ threshold: 1, credentials: [credential(ECDSA, 1)] }]))).toEqual([]);
  });

  it('raises clause.empty naming the clause with no credentials, and not once it holds one', () => {
    const draft = withClauses([
      { threshold: 1, credentials: [credential(ECDSA, 1), credential(PASSKEY, 2)] },
      { threshold: 0, credentials: [] },
    ]);

    expect(validateSetup(draft, SETUP_CONTEXT).errors).toEqual([
      { code: 'clause.empty', subject: 'clause', values: { clause: 1, count: 0 } },
    ]);
    expect(
      errorCodes(withClauses([draft.clauses[0]!, { threshold: 0, credentials: [credential(ECDSA, 5)] }])),
    ).toEqual([]);
  });

  it('raises rule.all-thresholds-zero listing every clause, and not when one clause sits above zero', () => {
    const allZero = withClauses([
      { threshold: 0, credentials: [credential(ECDSA, 1)] },
      { threshold: 0, credentials: [credential(PASSKEY, 2)] },
    ]);

    expect(validateSetup(allZero, SETUP_CONTEXT).errors).toEqual([
      {
        code: 'rule.all-thresholds-zero',
        subject: 'setup',
        values: { clauses: [{ clause: 0, threshold: 0 }, { clause: 1, threshold: 0 }] },
      },
    ]);
    expect(
      errorCodes(withClauses([allZero.clauses[0]!, { threshold: 1, credentials: [credential(PASSKEY, 2)] }])),
    ).toEqual([]);
  });

  it('raises clause.threshold-above-count at 3-of-2, and not at 2-of-2', () => {
    const credentials = [credential(ECDSA, 1), credential(PASSKEY, 2)];

    expect(validateSetup(withClauses([{ threshold: 3, credentials }]), SETUP_CONTEXT).errors).toEqual([
      { code: 'clause.threshold-above-count', subject: 'clause', values: { clause: 0, threshold: 3, count: 2 } },
    ]);
    expect(errorCodes(withClauses([{ threshold: 2, credentials }]))).toEqual([]);
  });

  it('raises clause.threshold-too-wide at 256 against the uint8 maximum 255, and not at 255', () => {
    const credentials = many(256);
    const clear = { publicMetadata: '0x' as Hex, backup: 'clear' as const };

    expect(
      validateSetup(withClauses([{ threshold: 256, credentials }], { privacy: clear }), SETUP_CONTEXT).errors,
    ).toEqual([{ code: 'clause.threshold-too-wide', subject: 'clause', values: { clause: 0, threshold: 256, maximum: 255 } }]);
    expect(errorCodes(withClauses([{ threshold: 255, credentials }], { privacy: clear }))).toEqual([]);
  });

  it('raises credential.duplicate for one method and config pair at two places whatever their salts', () => {
    const draft = withClauses([
      { threshold: 1, credentials: [credential(ECDSA, 1, { salt: SALT })] },
      { threshold: 1, credentials: [credential(PASSKEY, 2), credential(ECDSA, 1)] },
    ]);

    expect(findingsOf(validateSetup(draft, SETUP_CONTEXT), 'credential.duplicate')).toEqual([
      { code: 'credential.duplicate', subject: 'credential', values: { places: [0, 2], method: ECDSA, config: credential(ECDSA, 1).config } },
    ]);
  });

  it('compares configs regardless of hex case', () => {
    const upper = `0x${credential(ECDSA, 0xab).config.slice(2).toUpperCase()}` as Hex;
    const draft = withClauses([{ threshold: 1, credentials: [credential(ECDSA, 0xab), { method: ECDSA, config: upper }] }]);

    expect(errorCodes(draft)).toEqual(['credential.duplicate']);
  });

  it('does not raise credential.duplicate for one method under two configs', () => {
    const draft = withClauses([{ threshold: 1, credentials: [credential(ECDSA, 1), credential(ECDSA, 4)] }]);

    expect(errorCodes(draft)).toEqual([]);
  });

  it('raises wait.field-width one second past what uint48 leaves over the block time, and not at it', () => {
    const available = UINT48_MAX - T;

    expect(findingsOf(validateSetup({ ...DRAFT, wait: available + 1 }, SETUP_CONTEXT), 'wait.field-width')).toEqual([
      { code: 'wait.field-width', subject: 'setup', values: { wait: available + 1, available } },
    ]);
    expect(errorCodes({ ...DRAFT, wait: available })).not.toContain('wait.field-width');
  });

  it('raises wait.above-maximum one second past the 30-day maximum, and not at it', () => {
    expect(validateSetup({ ...DRAFT, wait: 2_592_001 }, SETUP_CONTEXT).errors).toEqual([
      { code: 'wait.above-maximum', subject: 'setup', values: { wait: 2_592_001, maxWait: 2_592_000 } },
    ]);
    expect(errorCodes({ ...DRAFT, wait: 2_592_000 })).toEqual([]);
  });

  it('reads the maximum wait from the client configuration', () => {
    const context = { ...SETUP_CONTEXT, configuration: { ...CONFIGURATION, maxWait: 3_600, shortWait: 60 } };

    expect(errorCodes({ ...DRAFT, wait: 3_601 }, context)).toEqual(['wait.above-maximum']);
    expect(errorCodes({ ...DRAFT, wait: 3_600 }, context)).toEqual([]);
  });

  it('raises action.unsupported when the action says no and the named implementation is not the served one', () => {
    const context = {
      ...SETUP_CONTEXT,
      action: { ...SETUP_CONTEXT.action, supportsAccount: false },
      configuration: { ...CONFIGURATION, accountImplementation: OTHER_IMPLEMENTATION },
    };

    expect(validateSetup(DRAFT, context)).toEqual({
      errors: [
        {
          code: 'action.unsupported',
          subject: 'action',
          values: {
            action: ACTION,
            account: ACCOUNT,
            supportsAccount: false,
            accountImplementation: OTHER_IMPLEMENTATION,
            servedImplementation: SERVED_IMPLEMENTATION,
          },
        },
      ],
      warnings: [],
    });
  });

  it.each([
    ['no implementation named', undefined],
    ['the served implementation named', SERVED_IMPLEMENTATION],
  ] as const)('raises action.unsupported on any no from the action, with %s', (_case, accountImplementation) => {
    const context = {
      ...SETUP_CONTEXT,
      action: { ...SETUP_CONTEXT.action, supportsAccount: false },
      configuration: { ...CONFIGURATION, ...(accountImplementation === undefined ? {} : { accountImplementation }) },
    };
    const result = validateSetup(DRAFT, context);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      code: 'action.unsupported',
      subject: 'action',
      values: { action: ACTION, account: ACCOUNT, supportsAccount: false, ...(accountImplementation === undefined ? {} : { accountImplementation }) },
    });
    expect(result.warnings).toEqual([]);
  });

  it.each([
    ['no implementation named', undefined],
    ['the served implementation named', SERVED_IMPLEMENTATION],
    ['another implementation named', OTHER_IMPLEMENTATION],
  ] as const)('raises no fit finding on a yes from the action, with %s', (_case, accountImplementation) => {
    const yes = { ...SETUP_CONTEXT, configuration: { ...CONFIGURATION, ...(accountImplementation === undefined ? {} : { accountImplementation }) } };

    expect(validateSetup(DRAFT, yes)).toEqual({ errors: [], warnings: [] });
  });

  it('raises backup.too-wide for seventeen widest credentials past the 2473-byte padding', () => {
    const draft = withClauses(widestClauses(17));

    expect(BACKUP_PADDING_SIZE).toBe(2_473);
    expect(referenceSize({ wait: 0, ignoresPause: false, clauses: draft.clauses })).toBe(2_627);
    expect(findingsOf(validateSetup(draft, SETUP_CONTEXT), 'backup.too-wide')).toEqual([
      { code: 'backup.too-wide', subject: 'setup', values: { plaintextSize: 2_627, paddingSize: 2_473 } },
    ]);
  });

  it('does not raise backup.too-wide at exactly the padding size or on a clear backup', () => {
    const sixteen = withClauses(widestClauses(16));

    expect(referenceSize({ wait: 0, ignoresPause: false, clauses: sixteen.clauses })).toBe(2_473);
    expect(errorCodes(sixteen)).toEqual([]);
    expect(errorCodes(withClauses(widestClauses(17), { privacy: { publicMetadata: '0x', backup: 'clear' } }))).toEqual([]);
  });

  it('raises backup.too-wide rather than throwing for a config wider than the serialization length field', () => {
    const huge: Hex = `0x${'01'.repeat(65_536)}`;
    const draft = withClauses([{ threshold: 1, credentials: [{ method: PASSKEY, config: huge }] }]);

    expect(findingsOf(validateSetup(draft, SETUP_CONTEXT), 'backup.too-wide')).toHaveLength(1);
  });
});

import { describe, expect, it } from 'vitest';
import { validateSetup, type KitNotification, type SetupValidationContext } from '../../src/index';
import {
  AADHAAR,
  ACCOUNT,
  ACTION,
  CONFIGURATION,
  DESCRIPTOR,
  DRAFT,
  ECDSA,
  OTHER_ACTION,
  PASSKEY,
  SALT,
  SETUP_CONTEXT,
  UNSHIPPED,
  ZKPASSPORT,
  credential,
  findingsOf,
  methodReads,
  withClauses,
} from './fixtures';

const warningsOf = (draft = DRAFT, context: SetupValidationContext = SETUP_CONTEXT) => validateSetup(draft, context).warnings;

const codes = (draft = DRAFT, context: SetupValidationContext = SETUP_CONTEXT): string[] =>
  warningsOf(draft, context).map((finding) => finding.code);

/** A setup notification over the account at one block. */
const setupEvent = (kind: 'setup-committed' | 'setup-cleared', action: string, block: number, account = ACCOUNT): KitNotification => {
  const at = { blockNumber: block, blockHash: `0x${'33'.repeat(32)}`, logIndex: 0, transactionHash: `0x${'44'.repeat(32)}`, removed: false } as const;
  const base = { account, action: action as `0x${string}`, nonce: 2n, at };

  return kind === 'setup-committed'
    ? { kind, ...base, setupCommitment: `0x${'55'.repeat(32)}`, publicMetadata: '0x', privateMetadata: '0x' }
    : { kind, ...base };
};

/** The warnings ordered by code, so two codes on one clause compare whatever order they were raised in. */
const sortedWarnings = (draft = DRAFT) => [...warningsOf(draft)].sort((left, right) => left.code.localeCompare(right.code));

const replaceReads = (reads: ReturnType<typeof methodReads>): SetupValidationContext => ({
  ...SETUP_CONTEXT,
  methods: SETUP_CONTEXT.methods.map((entry) => (entry.module === reads.module ? reads : entry)),
});

describe('validateSetup warnings', () => {
  it('raises clause.single-point at 2-of-2 and at 1-of-1, and not at 2-of-3', () => {
    expect(warningsOf(withClauses([{ threshold: 2, credentials: [credential(ECDSA, 1), credential(PASSKEY, 2)] }]))).toEqual([
      { code: 'clause.single-point', subject: 'clause', values: { clause: 0, threshold: 2, count: 2 } },
    ]);
    expect(codes(withClauses([{ threshold: 1, credentials: [credential(PASSKEY, 1)] }]))).toEqual(['clause.single-point']);
    expect(codes()).toEqual([]);
  });

  it('raises clause.threshold-zero for one zero clause beside a clause still to be met, and not without one', () => {
    const draft = withClauses([
      { threshold: 0, credentials: [credential(ECDSA, 1)] },
      { threshold: 2, credentials: [credential(ECDSA, 2), credential(PASSKEY, 3), credential(PASSKEY, 4)] },
    ]);

    expect(findingsOf(validateSetup(draft, SETUP_CONTEXT), 'clause.threshold-zero')).toEqual([
      { code: 'clause.threshold-zero', subject: 'clause', values: { clause: 0, otherClauses: [1] } },
    ]);
    expect(codes()).not.toContain('clause.threshold-zero');
  });

  it('raises clause.single-point on one credential whatever the threshold, a 0-of-1 beside a healthy clause with clause.threshold-zero', () => {
    const draft = withClauses([
      { threshold: 0, credentials: [credential(ECDSA, 1)] },
      { threshold: 2, credentials: [credential(ECDSA, 2), credential(PASSKEY, 3), credential(PASSKEY, 4)] },
    ]);

    expect(sortedWarnings(draft)).toEqual([
      { code: 'clause.single-point', subject: 'clause', values: { clause: 0, threshold: 0, count: 1 } },
      { code: 'clause.threshold-zero', subject: 'clause', values: { clause: 0, otherClauses: [1] } },
    ]);
  });

  it('raises clause.single-point at 1-of-1 and 3-of-3 with threshold and count, and not at 1-of-2', () => {
    const three = [credential(ECDSA, 1), credential(PASSKEY, 2), credential(ECDSA, 3)];

    expect(warningsOf(withClauses([{ threshold: 1, credentials: [credential(PASSKEY, 1)] }]))).toEqual([
      { code: 'clause.single-point', subject: 'clause', values: { clause: 0, threshold: 1, count: 1 } },
    ]);
    expect(warningsOf(withClauses([{ threshold: 3, credentials: three }]))).toEqual([
      { code: 'clause.single-point', subject: 'clause', values: { clause: 0, threshold: 3, count: 3 } },
    ]);
    expect(codes(withClauses([{ threshold: 1, credentials: [credential(ECDSA, 1), credential(PASSKEY, 2)] }]))).toEqual([]);
  });

  it('raises clause.shared-failure where every credential of a clause shares one method, and not across two', () => {
    const draft = withClauses([{ threshold: 2, credentials: [credential(ECDSA, 1), credential(ECDSA, 2), credential(ECDSA, 3)] }]);

    expect(warningsOf(draft)).toEqual([{ code: 'clause.shared-failure', subject: 'clause', values: { clause: 0, method: ECDSA, count: 3 } }]);
    expect(codes()).not.toContain('clause.shared-failure');
  });

  it('raises clause.secondary-only where secondary credentials alone meet the threshold, and not where they cannot', () => {
    const credentials = [credential(AADHAAR, 1), credential(ZKPASSPORT, 2), credential(ECDSA, 3)];

    expect(findingsOf(validateSetup(withClauses([{ threshold: 2, credentials }]), SETUP_CONTEXT), 'clause.secondary-only')).toEqual([
      { code: 'clause.secondary-only', subject: 'clause', values: { clause: 0, methods: [AADHAAR, ZKPASSPORT], threshold: 2, forgeable: 2 } },
    ]);
    expect(codes(withClauses([{ threshold: 3, credentials }]))).not.toContain('clause.secondary-only');
  });

  it('raises method.unshipped with the shipped set and whose descriptor it came from, and not for a shipped method', () => {
    const draft = withClauses([{ threshold: 1, credentials: [credential(UNSHIPPED, 1), credential(ECDSA, 2)] }]);
    const context = {
      ...replaceReads(methodReads(UNSHIPPED, 'primary', { moduleInfo: { answered: false }, implemented: false })),
      descriptorOrigin: 'integrator' as const,
    };

    expect(warningsOf(draft, context)).toEqual([
      {
        code: 'method.unshipped',
        subject: 'credential',
        values: {
          place: 0,
          module: UNSHIPPED,
          probeAnswered: false,
          probePassed: false,
          implemented: false,
          shippedMethods: DESCRIPTOR.shippedMethods,
          descriptorOrigin: 'integrator',
        },
      },
    ]);
    expect(codes()).not.toContain('method.unshipped');
  });

  it('raises method.no-declaration per credential whose method left trustedParties unanswered', () => {
    const context = replaceReads(methodReads(ECDSA, 'primary', { trustedParties: { answered: false } }));

    expect(warningsOf(DRAFT, context)).toEqual([
      { code: 'method.no-declaration', subject: 'credential', values: { place: 0, module: ECDSA, parties: 'unknown' } },
      { code: 'method.no-declaration', subject: 'credential', values: { place: 2, module: ECDSA, parties: 'unknown' } },
    ]);
  });

  it('raises method.stopped for a method answering paused with true, carrying whether the draft ignores stops', () => {
    const context = replaceReads(methodReads(PASSKEY, 'primary', { paused: { answered: true, value: true } }));

    expect(warningsOf({ ...DRAFT, ignoresPause: true }, context)).toEqual([
      { code: 'method.stopped', subject: 'credential', values: { place: 1, module: PASSKEY, paused: true, ignoresPause: true } },
    ]);
  });

  it('does not raise method.stopped for paused false or an unanswered read', () => {
    expect(codes(DRAFT, replaceReads(methodReads(PASSKEY, 'primary', { paused: { answered: false } })))).toEqual([]);
    expect(codes()).toEqual([]);
  });

  it('raises action.unaudited with the audited set and its origin, and not for an audited action', () => {
    const context: SetupValidationContext = {
      ...SETUP_CONTEXT,
      descriptor: { ...DESCRIPTOR, auditedActions: [OTHER_ACTION] },
      action: { ...SETUP_CONTEXT.action, actionInfo: { answered: true, value: { name: 'a', version: '1', supportsInterface: false } } },
    };

    expect(warningsOf(DRAFT, context)).toEqual([
      {
        code: 'action.unaudited',
        subject: 'action',
        values: { action: ACTION, probeAnswered: true, probePassed: false, auditedActions: [OTHER_ACTION], descriptorOrigin: 'kit' },
      },
    ]);
  });

  it('raises no warning on a no from the action with no implementation named: the no is the error action.unsupported', () => {
    const context = { ...SETUP_CONTEXT, action: { ...SETUP_CONTEXT.action, supportsAccount: false } };
    const result = validateSetup(DRAFT, context);

    expect(result.warnings).toEqual([]);
    expect(result.errors.map((finding) => finding.code)).toEqual(['action.unsupported']);
    expect(result.errors[0]?.values).toMatchObject({ action: ACTION, account: ACCOUNT, supportsAccount: false });
  });

  it('raises manager.already-armed for another action whose last setup event is a commit', () => {
    const events = [setupEvent('setup-cleared', OTHER_ACTION, 9), setupEvent('setup-committed', OTHER_ACTION, 10)];

    expect(warningsOf(DRAFT, { ...SETUP_CONTEXT, managerEvents: events })).toEqual([
      { code: 'manager.already-armed', subject: 'account', values: { account: ACCOUNT, action: OTHER_ACTION, nonce: 2n } },
    ]);
  });

  it('does not raise manager.already-armed after a later clear, for its own action, or for another account', () => {
    const cleared = [setupEvent('setup-cleared', OTHER_ACTION, 11), setupEvent('setup-committed', OTHER_ACTION, 10)];
    const own = [setupEvent('setup-committed', ACTION, 10)];
    const stranger = [setupEvent('setup-committed', OTHER_ACTION, 10, '0x1111111111111111111111111111111111111112')];

    for (const managerEvents of [cleared, own, stranger]) expect(codes(DRAFT, { ...SETUP_CONTEXT, managerEvents })).toEqual([]);
  });

  it('raises setup.wait-short one second under the 48-hour short wait, and not at it', () => {
    expect(warningsOf({ ...DRAFT, wait: 172_799 })).toEqual([
      { code: 'setup.wait-short', subject: 'setup', values: { wait: 172_799, shortWait: 172_800, alertingOperated: false } },
    ]);
    expect(codes({ ...DRAFT, wait: 172_800 })).toEqual([]);
  });

  it('reads the short wait from the client configuration', () => {
    const context = { ...SETUP_CONTEXT, configuration: { ...CONFIGURATION, shortWait: 3_600 } };

    expect(codes({ ...DRAFT, wait: 3_599 }, context)).toEqual(['setup.wait-short']);
    expect(codes({ ...DRAFT, wait: 3_600 }, context)).toEqual([]);
  });

  it('raises setup.wait-zero at a zero wait, and not at one second', () => {
    expect(warningsOf({ ...DRAFT, wait: 0 })).toEqual([
      { code: 'setup.wait-zero', subject: 'setup', values: { wait: 0, spendableInOpeningBlock: true } },
    ]);
    expect(codes({ ...DRAFT, wait: 1 })).toEqual(['setup.wait-short']);
  });

  it('raises backup.clear naming the places whose supplied salt it publishes, and not on an encrypted backup', () => {
    const draft = withClauses(
      [{ threshold: 2, credentials: [credential(ECDSA, 1), credential(PASSKEY, 2, { salt: SALT }), credential(ECDSA, 3)] }],
      { privacy: { publicMetadata: '0x', backup: 'clear' } },
    );

    expect(warningsOf(draft)).toEqual([{ code: 'backup.clear', subject: 'setup', values: { revocable: false, suppliedSaltPlaces: [1] } }]);
    expect(codes()).not.toContain('backup.clear');
  });

  it('raises backup.empty naming credentials no memory reproduces and those with a supplied salt', () => {
    const draft = withClauses(
      [{ threshold: 2, credentials: [credential(ECDSA, 1, { salt: SALT }), credential(PASSKEY, 2), credential(ECDSA, 3)] }],
      { privacy: { publicMetadata: '0x', backup: 'empty' } },
    );

    expect(warningsOf(draft)).toEqual([
      { code: 'backup.empty', subject: 'setup', values: { unreproduciblePlaces: [1], suppliedSaltPlaces: [0] } },
    ]);
    expect(codes()).not.toContain('backup.empty');
  });

  it('raises rule.repeated-person for one contact-book label on two places, and not for distinct labels', () => {
    const same = withClauses([
      { threshold: 2, credentials: [credential(ECDSA, 1, { label: 'alice' }), credential(PASSKEY, 2, { label: 'bob' }), credential(ECDSA, 3, { label: 'alice' })] },
    ]);
    const distinct = withClauses([
      { threshold: 2, credentials: [credential(ECDSA, 1, { label: 'alice' }), credential(PASSKEY, 2, { label: 'bob' }), credential(ECDSA, 3, { label: 'carol' })] },
    ]);

    expect(warningsOf(same)).toEqual([{ code: 'rule.repeated-person', subject: 'setup', values: { label: 'alice', places: [0, 2] } }]);
    expect(codes(distinct)).toEqual([]);
  });
});

import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeSetup, REMOVED_KEY_UNNAMED, type Address, type RemovedKey, type SetupDraft } from '../../src/index';
import {
  byMethod,
  CANDIDATE_A,
  CANDIDATE_B,
  CONFIGURATION,
  CONTEXT,
  DRAFT,
  ECDSA,
  GUARDIAN,
  OTHER_ACTION,
  OTHER_PAUSE_HOLDER,
  ACTION,
  AUDITED_ONLY_ACTION,
  ZKPASSPORT_PARTIES,
  PARTIES,
  PASSKEY,
  PASSKEY_CONFIG,
  PAUSE_HOLDER,
  SECOND_GUARDIAN,
  THIRD_PARTY,
  withMethod,
  ZKPASSPORT,
} from './setup-fixtures';

const full = describeSetup(DRAFT, CONTEXT);

describe('describeSetup: the rule', () => {
  it('lists every clause with its threshold and every credential at its flat place with method, name and label', () => {
    expect(full.rule.clauses).toEqual([
      {
        threshold: 2,
        credentials: [
          { place: 0, method: ECDSA, methodName: 'method-ecdsa', label: 'Alice' },
          { place: 1, method: PASSKEY, methodName: 'method-passkey' },
          { place: 2, method: ECDSA, methodName: 'method-ecdsa' },
        ],
      },
      {
        threshold: 1,
        credentials: [
          { place: 3, method: ZKPASSPORT, methodName: 'method-zkpassport', label: 'Passport' },
          { place: 4, method: THIRD_PARTY, methodName: 'their-method' },
        ],
      },
    ]);
  });

  it('leaves the method name out where moduleInfo was not answered, never a placeholder', () => {
    const credentials = describeSetup(DRAFT, withMethod(ECDSA, { moduleInfo: { answered: false } })).rule.clauses[0]?.credentials;

    expect(credentials?.[0]).toEqual({ place: 0, method: ECDSA, label: 'Alice' });
    expect(credentials?.[1]).toMatchObject({ methodName: 'method-passkey' });
  });

  it('describes an empty rule as no clauses', () => {
    const empty = describeSetup({ ...DRAFT, clauses: [] }, { ...CONTEXT, methods: [] });

    expect(empty.rule.clauses).toEqual([]);
    expect(empty.failureDomains).toEqual([]);
    expect(empty.parties).toEqual({ methods: [], walletGuardians: [] });
    expect(empty.passkeyDomains).toEqual([]);
  });
});

describe('describeSetup: the wait and the failure domains', () => {
  it('shows the committed wait beside the client default', () => {
    expect(full.wait).toEqual({ committed: 259_200, clientDefault: 172_800 });
    expect(describeSetup(DRAFT, { ...CONTEXT, configuration: { ...CONFIGURATION, defaultWait: 1 } }).wait.clientDefault).toBe(1);
  });

  it('counts, per clause, how many of its credentials each method carries', () => {
    expect(full.failureDomains.map((domain) => ({ ...domain, methods: byMethod(domain.methods) }))).toEqual([
      { clause: 0, methods: byMethod([{ method: ECDSA, count: 2 }, { method: PASSKEY, count: 1 }]) },
      { clause: 1, methods: byMethod([{ method: ZKPASSPORT, count: 1 }, { method: THIRD_PARTY, count: 1 }]) },
    ]);
  });
});

describe('describeSetup: the parties', () => {
  it('names every method\'s declared parties as read and every wallet guardian by address', () => {
    expect(byMethod(full.parties.methods)).toEqual(
      byMethod([
        { method: ECDSA, parties: { answered: true, value: PARTIES } },
        { method: PASSKEY, parties: { answered: true, value: { ...PARTIES, trustedKeys: [] } } },
        { method: ZKPASSPORT, parties: { answered: true, value: ZKPASSPORT_PARTIES } },
        { method: THIRD_PARTY, parties: { answered: true, value: PARTIES } },
      ]),
    );
    expect(full.parties.walletGuardians).toEqual([
      { place: 0, address: getAddress(GUARDIAN.value) },
      { place: 2, address: SECOND_GUARDIAN },
    ]);
  });

  it('marks a module that did not answer trustedParties as unknown parties rather than dropping it', () => {
    const description = describeSetup(DRAFT, withMethod(THIRD_PARTY, { trustedParties: { answered: false } }));
    const entry = description.parties.methods.find((method) => method.method === THIRD_PARTY);

    expect(entry).toEqual({ method: THIRD_PARTY, parties: { answered: false } });
    expect(description.parties.methods).toHaveLength(4);
  });

  it('keeps a declared pending admin and pending pause holder even when they are the zero address', () => {
    const zero = '0x0000000000000000000000000000000000000000';
    const declared = { ...PARTIES, pendingAdmin: zero, pendingPauseHolder: zero } as const;
    const description = describeSetup(DRAFT, withMethod(ZKPASSPORT, { trustedParties: { answered: true, value: declared } }));

    expect(description.parties.methods.find((method) => method.method === ZKPASSPORT)?.parties).toEqual({ answered: true, value: declared });
  });

  it('names a method with no wallet credentials no guardian', () => {
    const draft: SetupDraft = { ...DRAFT, clauses: [{ threshold: 1, credentials: [{ method: PASSKEY, config: PASSKEY_CONFIG.encoded }] }] };
    const description = describeSetup(draft, { ...CONTEXT, methods: CONTEXT.methods.filter((entry) => entry.module === PASSKEY) });

    expect(description.parties.walletGuardians).toEqual([]);
    expect(description.parties.methods.map((entry) => entry.method)).toEqual([PASSKEY]);
  });
});

describe('describeSetup: method standing', () => {
  it('states shipped, declared parties, probe, tier and pause for every method', () => {
    expect(byMethod(full.methodStanding)).toEqual(
      byMethod([
        { method: ECDSA, shipped: true, declaresParties: true, probePassed: { answered: true, value: true }, tier: 'primary', paused: { answered: true, value: false } },
        { method: PASSKEY, shipped: true, declaresParties: true, probePassed: { answered: true, value: true }, tier: 'primary', paused: { answered: true, value: false } },
        { method: ZKPASSPORT, shipped: true, declaresParties: true, probePassed: { answered: true, value: true }, tier: 'secondary', paused: { answered: true, value: true } },
        { method: THIRD_PARTY, shipped: false, declaresParties: true, probePassed: { answered: true, value: true }, paused: { answered: true, value: false } },
      ]),
    );
  });

  it('carries unanswered moduleInfo, trustedParties and paused reads as unanswered, never as a default', () => {
    const context = withMethod(THIRD_PARTY, { moduleInfo: { answered: false }, trustedParties: { answered: false }, paused: { answered: false } });
    const standing = describeSetup(DRAFT, context).methodStanding.find((entry) => entry.method === THIRD_PARTY);

    expect(standing).toEqual({ method: THIRD_PARTY, shipped: false, declaresParties: false, probePassed: { answered: false }, paused: { answered: false } });
  });

  it('reports a failed ERC-165 probe as answered false', () => {
    const context = withMethod(THIRD_PARTY, { moduleInfo: { answered: true, value: { name: 'x', version: '0', supportsInterface: false } } });

    expect(describeSetup(DRAFT, context).methodStanding.find((entry) => entry.method === THIRD_PARTY)?.probePassed).toEqual({
      answered: true,
      value: false,
    });
  });
});

describe('describeSetup: passkey domains and candidate keys', () => {
  it('names each passkey credential\'s relying-party id hash, the last word of its config', () => {
    expect(full.passkeyDomains).toEqual([{ place: 1, relyingPartyIdHash: PASSKEY_CONFIG.value }]);
  });

  it('lists every configured candidate key with its isAuthority answer, in the configuration\'s order', () => {
    expect(full.candidateKeys).toEqual([
      { key: CANDIDATE_A, isAuthority: true },
      { key: CANDIDATE_B, isAuthority: false },
    ]);
  });

  it('lists no candidate key where the configuration names none', () => {
    const context = { ...CONTEXT, configuration: { ...CONFIGURATION, candidateKeys: [] }, candidateKeys: [] };

    expect(describeSetup(DRAFT, context).candidateKeys).toEqual([]);
  });
});

describe('describeSetup: removedKey is copied as the client computed it', () => {
  it.each<RemovedKey>([CANDIDATE_A, ...REMOVED_KEY_UNNAMED])('carries %s', (removedKey) => {
    expect(describeSetup(DRAFT, { ...CONTEXT, removedKey }).removedKey).toBe(removedKey);
  });

  it('covers the three unnamed values', () => {
    expect([...REMOVED_KEY_UNNAMED].sort()).toEqual(['no-source', 'not-a-key', 'unread']);
  });
});

describe('describeSetup: privacy, backup, reveals and cancel', () => {
  it('carries the draft\'s privacy choices', () => {
    expect(full.privacy).toEqual({ publicMetadata: '0x1234', backup: 'encrypted' });
  });

  it.each(['encrypted', 'clear', 'empty'] as const)('describes the %s backup choice', (backup) => {
    const description = describeSetup({ ...DRAFT, privacy: { ...DRAFT.privacy, backup } }, CONTEXT);

    expect(description.backup.choice).toBe(backup);
    expect(description.privacy.backup).toBe(backup);
  });

  it('flags a supplied salt and names the places whose salt is supplied', () => {
    expect(full.backup.anySuppliedSalt).toBe(true);
    expect(full.reveals).toEqual({ suppliedSaltPlaces: [1, 4] });
  });

  it('flags no supplied salt where every credential takes the default', () => {
    const plain = DRAFT.clauses.map((clause) => ({
      ...clause,
      credentials: clause.credentials.map((credential) => ({ method: credential.method, config: credential.config })),
    }));
    const description = describeSetup({ ...DRAFT, clauses: plain }, CONTEXT);

    expect(description.backup.anySuppliedSalt).toBe(false);
    expect(description.reveals).toEqual({ suppliedSaltPlaces: [] });
  });

  it('lets anyone cancel by veto unless the setup ignores stops', () => {
    expect(full.cancel).toEqual({ cancelByVeto: true });
    expect(describeSetup({ ...DRAFT, ignoresPause: true }, CONTEXT).cancel).toEqual({ cancelByVeto: false });
  });
});

describe('describeSetup: upgrade and pause', () => {
  it('says the shipped action\'s account cannot be upgraded in place', () => {
    expect(full.upgrade).toEqual({ upgradeableInPlace: false });
  });

  it('says so for the descriptor\'s action in any case spelling', () => {
    const context = { ...CONTEXT, action: { ...CONTEXT.action, address: ACTION.toUpperCase().replace('0X', '0x') as Address } };

    expect(describeSetup(DRAFT, context).upgrade).toEqual({ upgradeableInPlace: false });
  });

  it('leaves upgradeability unstated for an action that is audited but not the descriptor\'s own', () => {
    const context = { ...CONTEXT, action: { ...CONTEXT.action, address: AUDITED_ONLY_ACTION } };

    expect(describeSetup(DRAFT, context).upgrade).toEqual({});
    expect('upgradeableInPlace' in describeSetup(DRAFT, context).upgrade).toBe(false);
  });

  it('leaves upgradeability unstated for a third-party action', () => {
    const context = { ...CONTEXT, action: { ...CONTEXT.action, address: OTHER_ACTION } };

    expect(describeSetup(DRAFT, context).upgrade).toEqual({});
  });

  it('states per method whether it is stopped and who holds the stop, beside the setup\'s own choice', () => {
    expect(full.pause.ignoresPause).toBe(false);
    expect(byMethod(full.pause.methods)).toEqual(
      byMethod([
        { method: ECDSA, paused: { answered: true, value: false }, pauseHolder: { answered: true, value: PAUSE_HOLDER } },
        { method: PASSKEY, paused: { answered: true, value: false }, pauseHolder: { answered: true, value: PAUSE_HOLDER } },
        { method: ZKPASSPORT, paused: { answered: true, value: true }, pauseHolder: { answered: true, value: OTHER_PAUSE_HOLDER } },
        { method: THIRD_PARTY, paused: { answered: true, value: false }, pauseHolder: { answered: true, value: PAUSE_HOLDER } },
      ]),
    );
    expect(describeSetup({ ...DRAFT, ignoresPause: true }, CONTEXT).pause.ignoresPause).toBe(true);
  });

  it('carries an unanswered paused read as unanswered while the pause holder still follows trustedParties', () => {
    const entry = describeSetup(DRAFT, withMethod(PASSKEY, { paused: { answered: false } })).pause.methods.find((method) => method.method === PASSKEY);

    expect(entry).toEqual({ method: PASSKEY, paused: { answered: false }, pauseHolder: { answered: true, value: PAUSE_HOLDER } });
  });

  it('carries the pause holder as unanswered where trustedParties was not answered, the paused read unaffected', () => {
    const entry = describeSetup(DRAFT, withMethod(ZKPASSPORT, { trustedParties: { answered: false } })).pause.methods.find(
      (method) => method.method === ZKPASSPORT,
    );

    expect(entry).toEqual({ method: ZKPASSPORT, paused: { answered: true, value: true }, pauseHolder: { answered: false } });
  });

  it('takes each method\'s pause holder from that method\'s own declaration', () => {
    const holders = describeSetup(DRAFT, CONTEXT).pause.methods.map((entry) => [entry.method, entry.pauseHolder]);

    expect(holders).toContainEqual([ZKPASSPORT, { answered: true, value: OTHER_PAUSE_HOLDER }]);
    expect(holders).toContainEqual([ECDSA, { answered: true, value: PAUSE_HOLDER }]);
  });
});

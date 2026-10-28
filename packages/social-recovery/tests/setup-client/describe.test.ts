import { describe, expect, it } from 'vitest';
import { describeSetup, type RemovedKey, type SetupDescriptionContext, type SetupDraft } from '../../src/index';
import {
  ACTION,
  ACTION_INFO,
  ALL_ACTIONS_FILTER,
  build,
  CONFIGURATION,
  DESCRIPTOR,
  DRAFT,
  KEY_1,
  KEY_2,
  members,
  METHOD_A,
  METHOD_B,
  MODULE_ANSWERS,
  PIN,
} from './doubles';

/** The description context the client should hand the pure function, built from what the doubles answer. */
const expectedContext = (draft: SetupDraft, authority: readonly boolean[], removedKey: RemovedKey = 'no-source'): SetupDescriptionContext => ({
  descriptor: DESCRIPTOR,
  configuration: CONFIGURATION,
  methods: [...new Set(draft.clauses.flatMap((clause) => clause.credentials.map((credential) => credential.method)))].map((module) => ({
    module,
    ...MODULE_ANSWERS,
    implemented: module === METHOD_A || module === METHOD_B,
  })),
  action: { address: ACTION, actionInfo: { answered: true, value: ACTION_INFO }, supportsAccount: true },
  candidateKeys: [KEY_1, KEY_2].map((key, index) => ({ key, isAuthority: authority[index] ?? false })),
  removedKey,
});

describe('describeSetup', () => {
  it('answers what the pure description answers over the reads the doubles gave, its removed key aside', async () => {
    const { client } = build({ world: { authority: (key) => key === KEY_1 } });
    const description = await client.describeSetup(DRAFT);

    expect(description).toEqual(describeSetup(DRAFT, expectedContext(DRAFT, [true, false], description.removedKey)));
  });

  it('asks isAuthority once per candidate key at the pinned block', async () => {
    const { client, seen } = build();

    await client.describeSetup(DRAFT);

    const asked = seen.parts.filter((part) => part.member === 'isAuthority');

    expect(asked.map((part) => String(part.args[0]).toLowerCase())).toEqual([KEY_1, KEY_2].map((key) => key.toLowerCase()));
    expect(asked.every((part) => JSON.stringify(part.args[1]) === JSON.stringify(PIN))).toBe(true);
    expect(seen.blockTags).toEqual(['latest']);
  });

  it('makes no account-wide log read and no stateOf read', async () => {
    const { client, seen } = build();

    await client.describeSetup(DRAFT);

    expect(seen.fetches.filter((read) => read.filter === ALL_ACTIONS_FILTER)).toEqual([]);
    expect(seen.filterOptions.some((options) => options?.allActions === true)).toBe(false);
    expect(members(seen)).not.toContain('manager.stateOf');
  });

  it("names no removed key where no handover was consumed and no signer can be recovered: 'no-source'", async () => {
    expect((await build().client.describeSetup(DRAFT)).removedKey).toBe('no-source');
  });

  it('reads every candidate key as false on a code-less account without calling isAuthority', async () => {
    const { client, seen } = build({ world: { code: '0x', authority: () => ({ rejects: { data: '0x' } }) } });
    const description = await client.describeSetup(DRAFT);

    expect(description.candidateKeys).toEqual([
      { key: KEY_1, isAuthority: false },
      { key: KEY_2, isAuthority: false },
    ]);
    expect(members(seen)).not.toContain('action.isAuthority');
  });

  it('describes the checked draft: uppercase public metadata comes back lower-cased, the caller\'s draft untouched', async () => {
    const draft: SetupDraft = { ...DRAFT, privacy: { publicMetadata: '0xDEADBEEF', backup: 'encrypted' } };
    const description = await build().client.describeSetup(draft);

    expect(description.privacy.publicMetadata).toBe('0xdeadbeef');
    expect(draft.privacy.publicMetadata).toBe('0xDEADBEEF');
  });

  it('describes under the version escape', async () => {
    await expect(build({ escaped: true }).client.describeSetup(DRAFT)).resolves.toBeDefined();
  });

  it('pins every part call to the one block', async () => {
    const { client, seen } = build();

    await client.describeSetup(DRAFT);

    for (const call of seen.parts.filter((part) => part.part !== 'events')) {
      expect(call.args[call.args.length - 1], `${call.part}.${call.member}`).toEqual(PIN);
    }
  });
});

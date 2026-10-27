import { describe, expect, it } from 'vitest';
import { ACCOUNT, build, DRAFT, KEY_1, KEY_2, members, PIN } from './doubles';

const codeReads = (seen: ReturnType<typeof build>['seen']) => seen.provider.filter((member) => member === 'code');

describe('the account code read behind account.not-deployed', () => {
  it.each(['validateSetup', 'describeSetup'] as const)('%s reads the account code once, at the pinned block', async (call) => {
    const { client, seen } = build();

    await client[call](DRAFT);

    expect(codeReads(seen)).toHaveLength(1);
    expect(seen.codes).toEqual([{ address: ACCOUNT, block: PIN.number }]);
  });

  it.each(['validateSetup', 'describeSetup'] as const)('%s reads the account code once on a code-less account too', async (call) => {
    const { client, seen } = build({ world: { code: '0x' } });

    await client[call](DRAFT);

    expect(codeReads(seen)).toHaveLength(1);
  });

  it('validateSetup on a code-less account answers account.not-deployed and no action.unsupported, even when the action says no', async () => {
    for (const supportsAccount of [true, false]) {
      const result = await build({ world: { code: '0x', supportsAccount } }).client.validateSetup(DRAFT);
      const codes = result.errors.map((finding) => finding.code);

      expect(codes, String(supportsAccount)).toContain('account.not-deployed');
      expect(codes, String(supportsAccount)).not.toContain('action.unsupported');
    }
  });

  it('validateSetup on an account holding code raises no account.not-deployed', async () => {
    const result = await build().client.validateSetup(DRAFT);

    expect(result.errors.map((finding) => finding.code)).not.toContain('account.not-deployed');
  });

  it('describeSetup keeps the candidate keys\' code-gated authority reads: asked with code, false without asking where there is none', async () => {
    const deployed = build({ world: { authority: (key) => key === KEY_1 } });
    const described = await deployed.client.describeSetup(DRAFT);

    expect(described.candidateKeys).toEqual([
      { key: KEY_1, isAuthority: true },
      { key: KEY_2, isAuthority: false },
    ]);
    expect(members(deployed.seen)).toContain('action.isAuthority');

    const bare = build({ world: { code: '0x', authority: () => true } });

    expect((await bare.client.describeSetup(DRAFT)).candidateKeys.every((entry) => !entry.isAuthority)).toBe(true);
    expect(members(bare.seen)).not.toContain('action.isAuthority');
  });
});

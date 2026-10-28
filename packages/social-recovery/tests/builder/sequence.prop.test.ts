import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BUILDER_CHAIN_MISMATCH_MESSAGE,
  BUILDER_DIGEST_VERSION_MESSAGE,
  BUILDER_DOMAIN_CHAIN_MESSAGE,
  BUILDER_DOMAIN_FIELDS_MESSAGE,
  BUILDER_DOMAIN_NAME_MESSAGE,
  BUILDER_NO_DOMAIN_MESSAGE,
  BUILDER_VERIFYING_CONTRACT_MESSAGE,
  KitRefusalError,
  SocialRecoveryBuilder,
  type BuilderEscapedCheck,
} from '../../src/index';
import { ChainDouble, FC_PARAMS, OTHER_MANAGER, TIMEOUT, goodDomain, goodWorld, holder, type ChainWorld, type DomainAnswer } from './doubles';

type Fault = 'chain' | 'domain-revert' | 'domain-chain' | 'verifying' | 'fields' | 'version' | 'name' | 'release';

const FAULTS: readonly Fault[] = ['chain', 'domain-revert', 'domain-chain', 'verifying', 'fields', 'version', 'name', 'release'];

/** The world answering wrong in exactly the given faults. */
function worldWith(faults: ReadonlySet<Fault>): ChainWorld {
  const domain: DomainAnswer = {
    ...goodDomain(),
    ...(faults.has('domain-chain') ? { chainId: 5 } : {}),
    ...(faults.has('verifying') ? { verifyingContract: OTHER_MANAGER } : {}),
    ...(faults.has('fields') ? { fields: '0x1f' as const, salt: `0x${'ab'.repeat(32)}` as const } : {}),
    ...(faults.has('version') ? { version: '2' } : {}),
    ...(faults.has('name') ? { name: 'PolicyManagerV2' } : {}),
  };

  return {
    chainId: faults.has('chain') ? 5 : goodWorld().chainId,
    domain: faults.has('domain-revert') ? { reverts: '0x' } : domain,
    version: faults.has('release') ? '9.9.9' : '1.0.0',
  };
}

/** What one build over the faults ended in. */
type Outcome = { readonly message?: string; readonly escaped?: readonly BuilderEscapedCheck[]; readonly versionMismatch?: boolean; readonly reads: readonly string[] };

async function outcomeOf(faults: ReadonlySet<Fault>, escape: boolean): Promise<Outcome> {
  const provider = new ChainDouble(worldWith(faults));
  const builder = SocialRecoveryBuilder.from(holder(provider));

  if (escape) builder.withVersionEscape();

  try {
    await builder.buildSetupClient();
  } catch (thrown) {
    if (!(thrown instanceof KitRefusalError)) throw thrown;

    return { message: thrown.message, reads: provider.reads };
  }

  const reading = builder.managerReading()!;

  return { escaped: reading.escaped, versionMismatch: reading.versionMismatch, reads: provider.reads };
}

/** The refusal each check carries, by the check's name: taken from the exported constants, never from a build's own answer. */
const MESSAGE_OF: Readonly<Record<Exclude<Fault, 'release'>, string>> = {
  chain: BUILDER_CHAIN_MISMATCH_MESSAGE,
  'domain-revert': BUILDER_NO_DOMAIN_MESSAGE,
  'domain-chain': BUILDER_DOMAIN_CHAIN_MESSAGE,
  verifying: BUILDER_VERIFYING_CONTRACT_MESSAGE,
  fields: BUILDER_DOMAIN_FIELDS_MESSAGE,
  version: BUILDER_DIGEST_VERSION_MESSAGE,
  name: BUILDER_DOMAIN_NAME_MESSAGE,
};

/** The messages the first failing check may carry, or the reading a passing build records. */
function expected(faults: ReadonlySet<Fault>, escape: boolean): { readonly messages?: readonly string[]; readonly escaped?: readonly BuilderEscapedCheck[] } {
  const messagesOf = (...names: Fault[]) => ({ messages: names.filter((name) => faults.has(name)).map((name) => MESSAGE_OF[name as Exclude<Fault, 'release'>]) });

  if (faults.has('chain')) return messagesOf('chain');

  if (faults.has('domain-revert')) return messagesOf('domain-revert');

  if (faults.has('domain-chain') || faults.has('verifying')) return messagesOf('domain-chain', 'verifying');

  if (!escape && faults.has('fields')) return messagesOf('fields');

  if (!escape && (faults.has('version') || faults.has('name'))) return messagesOf('version', 'name');

  const escaped: BuilderEscapedCheck[] = [];

  if (faults.has('fields')) escaped.push('fields');

  if (faults.has('version')) escaped.push('digest-version');

  if (faults.has('name')) escaped.push('domain-name');

  return { escaped };
}

describe('the construction sequence over arbitrary wrong answers', () => {
  it(
    'refuses with the first failing check, or builds recording exactly the escaped checks',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.subarray([...FAULTS]), fc.boolean(), async (list, escape) => {
          const faults = new Set(list);
          const outcome = await outcomeOf(faults, escape);
          const want = expected(faults, escape);

          if (want.messages !== undefined) {
            expect(want.messages).toContain(outcome.message);
            expect(outcome.reads).toEqual(faults.has('chain') ? ['chainId'] : ['chainId', 'eip712Domain']);
          } else {
            expect(outcome.message).toBeUndefined();
            expect(outcome.escaped).toEqual(want.escaped);
            expect(outcome.versionMismatch).toBe(faults.has('release'));
            expect(outcome.reads).toEqual(['chainId', 'eip712Domain', 'version']);
          }
        }),
        FC_PARAMS,
      );
    },
    TIMEOUT,
  );

  it(
    'names the single wrong answer\'s own check',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(...FAULTS.filter((name) => name !== 'release')), async (fault) => {
          const outcome = await outcomeOf(new Set([fault]), false);

          expect(outcome.message).toBe(MESSAGE_OF[fault as Exclude<Fault, 'release'>]);
        }),
        FC_PARAMS,
      );
    },
    TIMEOUT,
  );
});

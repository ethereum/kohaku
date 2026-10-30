import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { validateSetup, type Clause, type Credential } from '../../src/index';
import { TIMEOUT, run } from '../formats/arbitraries';
import { AADHAAR, ECDSA, PASSKEY, SALT, SETUP_CONTEXT, ZKPASSPORT, config, withClauses } from './fixtures';

/** A credential from a small pool of method and config pairs, so repeats are common. */
const pooled: fc.Arbitrary<Credential> = fc.record({
  method: fc.constantFrom(ECDSA, PASSKEY, AADHAAR, ZKPASSPORT),
  config: fc.integer({ min: 1, max: 4 }).map(config),
  salt: fc.option(fc.constant(SALT), { nil: undefined }),
}).map(({ salt, ...rest }) => (salt === undefined ? rest : { ...rest, salt }));

const clauses: fc.Arbitrary<Clause[]> = fc.array(
  fc.record({ threshold: fc.integer({ min: 0, max: 4 }), credentials: fc.array(pooled, { maxLength: 4 }) }),
  { minLength: 1, maxLength: 3 },
);

const duplicates = (rule: readonly Clause[]): number =>
  validateSetup(withClauses(rule), SETUP_CONTEXT).errors.filter((finding) => finding.code === 'credential.duplicate').length;

/** Counts repeated method and config pairs independently, each pair beyond its first occurrence once. */
const expectedDuplicates = (rule: readonly Clause[]): number => {
  const seen = new Set<string>();
  let repeats = 0;

  for (const credential of rule.flatMap((clause) => clause.credentials)) {
    const pair = `${credential.method.toLowerCase()}|${credential.config.toLowerCase()}`;

    if (seen.has(pair)) repeats += 1;
    else seen.add(pair);
  }

  return repeats;
};

describe('credential.duplicate properties', () => {
  it('counts one finding per repeated method and config pair', () => {
    run(fc.property(clauses, (rule) => {
      expect(duplicates(rule)).toBe(expectedDuplicates(rule));
    }));
  }, TIMEOUT);

  it('adding a credential anywhere never removes credential.duplicate once present', () => {
    run(fc.property(clauses, pooled, fc.nat(), fc.nat(), (rule, added, clauseIndex, position) => {
      fc.pre(duplicates(rule) > 0);

      const target = clauseIndex % rule.length;
      const grown = rule.map((clause, index) => {
        if (index !== target) return clause;

        const credentials = [...clause.credentials];

        credentials.splice(position % (credentials.length + 1), 0, added);

        return { ...clause, credentials };
      });

      expect(duplicates(grown)).toBeGreaterThan(0);
    }));
  }, TIMEOUT);
});

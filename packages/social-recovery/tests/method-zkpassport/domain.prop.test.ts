import fc from 'fast-check';
import { bytesToHex } from 'viem';
import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import * as constants from '../../src/constants';
import type { Hex } from '../../src/interfaces';
import {
  asHex,
  DEFAULT_OUTER,
  DIGEST,
  encodeConfig,
  encodeProof,
  IDENTIFIER,
  makeCtx,
  outerFor,
  PARAMS,
  peerDomain,
  scopeWord,
  stackDouble,
  stackProof,
  thrown,
  word,
  type OuterMaterial,
  type StackCall,
} from './fixtures';

const NUM_RUNS = Number(process.env['FC_NUM_RUNS'] ?? 256);

const SEED = process.env['FC_SEED'] === undefined ? {} : { seed: Number(process.env['FC_SEED']) };

const PIECES = [
  'http://', 'https://', 'HTTPS://', 'Http://', '/', '//', ':', ':443', ':8080', '?', '?a=b', '#', '#x', ' ', '\t', '\n',
  'a', 'z', 'Z', 'zk', 'passport', '.', '-', 'id', 'example', 'localhost', 'İ', 'ü', 'ß', 'é', 'Σ', 'ς', 'ǅ', '0', '9', '&', '%', '+', '@',
];

/** Text built from the parts a URL or a host is made of, so both kept and rewritten domains come up often. */
const piecesArb = fc.array(fc.constantFrom(...PIECES), { minLength: 1, maxLength: 8 }).map((pieces) => pieces.join(''));

/** A lower-case host the stack keeps as given. */
const hostArb = fc.array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789.-ü'), { minLength: 1, maxLength: 24 }).map((chars) => chars.join(''));

const domainArb = fc.oneof(piecesArb, hostArb, fc.string({ unit: 'grapheme', minLength: 1, maxLength: 30 }));

const keptArb = fc.oneof(hostArb, domainArb).filter((domain) => peerDomain(domain) === domain);

const scopeArb = fc.oneof(fc.string({ unit: 'grapheme', minLength: 1, maxLength: 40 }), fc.constantFrom(PARAMS.scope, 'bigproof', 's'));

const wordArb = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((bytes) => bytesToHex(bytes));

const enrollment = { result: { verified: true, uniqueIdentifier: IDENTIFIER.toString(10), proofs: [stackProof('outer_evm_count_4')] } };

const reply = { proofs: [stackProof('outer_evm_count_5', DIGEST)] };

const proofOf = (outer: OuterMaterial): Hex =>
  encodeProof(asHex(outer.vkeyHash), asHex(outer.proof), outer.publicInputs.map(asHex), asHex(outer.committedInputs));

const verifierDomains = (calls: readonly StackCall[]): string[] =>
  calls.flatMap((call) => (call.kind === 'verifier-parameters' ? [call.args.domain ?? ''] : []));

const constructed = (calls: readonly StackCall[]): string[] => calls.flatMap((call) => (call.kind === 'construct' ? [call.domain] : []));

describe('method-zkpassport domain properties', () => {
  it('enrollInput accepts a domain exactly when the copied peer rule keeps it; the stack and the verifier parameters get that string and the config commits it', async () => {
    await fc.assert(
      fc.asyncProperty(domainArb, async (domain) => {
        const double = stackDouble({ outer: outerFor(domain, PARAMS.scope) });
        const method = zkPassportMethod({ stack: double.stack });

        if (peerDomain(domain) !== domain) {
          const error = thrown(() => method.enrollInput({ ...PARAMS, domain }));

          expect(error).toBeInstanceOf(TypeError);
          expect((error as Error).message).toBe(constants.METHOD_ZKPASSPORT_DOMAIN_MESSAGE);
          expect(double.calls).toEqual([]);

          return;
        }

        const input = method.enrollInput({ ...PARAMS, domain });

        await (input['openRequest'] as () => Promise<unknown>)();

        expect(await method.configFrom(input, enrollment)).toBe(encodeConfig(word(IDENTIFIER), domain, PARAMS.scope, 604800n));
        expect(constructed(double.calls)).toEqual([domain, domain]);
        expect(verifierDomains(double.calls)).toEqual([domain]);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);

  it('signingInput accepts a domain exactly when the copied peer rule keeps it; the stack and the verifier parameters get that string', async () => {
    await fc.assert(
      fc.asyncProperty(domainArb, async (domain) => {
        const outer = outerFor(domain, PARAMS.scope);
        const double = stackDouble({ outer });
        const method = zkPassportMethod({ stack: double.stack });
        const ctx = makeCtx(encodeConfig(word(IDENTIFIER), domain, PARAMS.scope, 604800n));

        if (peerDomain(domain) !== domain) {
          const error = thrown(() => method.signingInput(ctx, { ...PARAMS, domain }));

          expect(error).toBeInstanceOf(TypeError);
          expect((error as Error).message).toBe(constants.METHOD_ZKPASSPORT_DOMAIN_MESSAGE);
          expect(double.calls).toEqual([]);

          return;
        }

        const input = method.signingInput(ctx, { ...PARAMS, domain });

        await (input['openRequest'] as () => Promise<unknown>)();

        expect(await method.replyFrom(ctx, input, reply)).toBe(proofOf(outer));
        expect(constructed(double.calls)).toEqual([domain, domain]);
        expect(verifierDomains(double.calls)).toEqual([domain]);
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);
});

/** The words a case puts at 3 and 4: the committed ones, either replaced, or both swapped. */
const wordsArb = (domain: string, scope: string) =>
  fc.oneof(
    fc.constant([scopeWord(domain), scopeWord(scope)] as const),
    wordArb.map((replaced) => [replaced, scopeWord(scope)] as const),
    wordArb.map((replaced) => [scopeWord(domain), replaced] as const),
    domainArb.map((other) => [scopeWord(other), scopeWord(scope)] as const),
    scopeArb.map((other) => [scopeWord(domain), scopeWord(other)] as const),
    fc.constant([scopeWord(scope), scopeWord(domain)] as const),
  );

const caseArb = fc
  .tuple(keptArb, scopeArb)
  .chain(([domain, scope]) => fc.tuple(fc.constant(domain), fc.constant(scope), wordsArb(domain, scope)));

describe('method-zkpassport scope-word properties', () => {
  it('configFrom, replyFrom and verify accept exactly a proof whose words 3 and 4 are the committed domain\'s and scope\'s', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ([domain, scope, [domainWord, scopeHash]]) => {
        const outer: OuterMaterial = {
          ...DEFAULT_OUTER,
          publicInputs: DEFAULT_OUTER.publicInputs.map((input, index) => (index === 3 ? domainWord : index === 4 ? scopeHash : input)),
        };
        const method = zkPassportMethod({ stack: stackDouble({ outer }).stack });
        const config = encodeConfig(word(IDENTIFIER), domain, scope, 604800n);
        const ctx = makeCtx(config);
        const accepted = domainWord === scopeWord(domain) && scopeHash === scopeWord(scope);
        const rejected = constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED;

        expect(await method.configFrom(method.enrollInput({ ...PARAMS, domain, scope }), enrollment)).toEqual(accepted ? config : rejected);
        expect(await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), reply)).toEqual(accepted ? proofOf(outer) : rejected);
        expect(await method.verify(ctx, proofOf(outer))).toBe(accepted ? 'not-judged' : 'rejected');
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);

  it('replyFrom answers request-unsupported, asking the stack nothing, exactly for a config whose domain is empty or rewritten or whose scope is empty', async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(domainArb, fc.constant('')), fc.oneof(scopeArb, fc.constant('')), async (domain, scope) => {
        const outer = outerFor(domain, scope);
        const double = stackDouble({ outer });
        const method = zkPassportMethod({ stack: double.stack });
        const ctx = makeCtx(encodeConfig(word(IDENTIFIER), domain, scope, 604800n));
        const servable = domain !== '' && scope !== '' && peerDomain(domain) === domain;
        const answer = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), reply);

        if (servable) {
          expect(answer).toBe(proofOf(outer));
        } else {
          expect(answer).toEqual(constants.METHOD_ZKPASSPORT_REQUEST_UNSUPPORTED);
          expect(double.calls).toEqual([]);
        }
      }),
      { numRuns: NUM_RUNS, ...SEED },
    );
  }, 600_000);
});

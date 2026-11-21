import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import * as constants from '../../src/constants';
import type { EnrollInput, Hex, Input, Material, Params } from '../../src/interfaces';
import { PACKAGE_ROOT } from '../helpers/source';
import {
  asHex,
  DEFAULT_OUTER,
  DIGEST,
  encodeConfig,
  encodeProof,
  IDENTIFIER,
  makeCtx,
  outerFor,
  outerInputs,
  PARAMS,
  PEER_DOMAIN_STEPS,
  peerDomain,
  scopeWord,
  stackDouble,
  stackProof,
  thrown,
  word,
  type OuterMaterial,
  type StackCall,
} from './fixtures';

type Opened = { readonly [name: string]: unknown };

const open = async (record: EnrollInput | Input): Promise<Opened> => (record['openRequest'] as () => Promise<Opened>)();

const CONFIG = encodeConfig(word(IDENTIFIER), PARAMS.domain, PARAMS.scope, 604800n);

const enrollMaterial = (identifier: bigint = IDENTIFIER): Material => ({
  result: { verified: true, uniqueIdentifier: identifier.toString(10), proofs: [stackProof('sig_check_dsc'), stackProof('outer_evm_count_4')] },
});

const replyMaterial = (): Material => ({ proofs: [stackProof('disclose_bytes_evm', DIGEST), stackProof('outer_evm_count_5', DIGEST)] });

const proofOf = (outer: OuterMaterial): Hex =>
  encodeProof(asHex(outer.vkeyHash), asHex(outer.proof), outer.publicInputs.map(asHex), asHex(outer.committedInputs));

const verifierCalls = (calls: readonly StackCall[]) => calls.filter((call) => call.kind === 'verifier-parameters');

/** The default outer material with the words at the given positions replaced. */
const outerWith = (replaced: { readonly [index: number]: string }): OuterMaterial => ({
  ...DEFAULT_OUTER,
  publicInputs: DEFAULT_OUTER.publicInputs.map((input, index) => replaced[index] ?? input),
});

/** The ten public inputs of a real outer proof made for domain `zkpassport.id` and scope `bigproof`, copied from the contracts repository's zkPassport digest fixture. */
const REAL_INPUTS = [
  '0x22af8a21f6e0ba285f027ac20323538fc63d87934f452b8f664610fbd4274804',
  '0x101198d63c981db5992b997b0e299fd73562eb8571ddccea34d41be9ce048a38',
  '0x000000000000000000000000000000000000000000000000000000006ac3deff',
  '0x008d535e2a7f4ee38a4d12aa88bcf21d2c2f6fa051d12eafba6655bf37e8c11c',
  '0x00f54fbb0f658e7013ec2114ef095a29bb3e2f95b96dbd93e46f12f67863111a',
  '0x008ebb812c3e10f4652083fa13b278399f162ecdf861bcc69b224a453c009396',
  '0x00efeafa09526d323a4e914d4954ea79fbed7881e721d56d87fb61d5c367cb16',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
  '0x171de101deed3f056917faecfe6cc04db2ef02689a8a483962a688948ce44461',
  '0x0000000000000000000000000000000000000000000000000000000000000000',
] as const;

const REAL_OUTER: OuterMaterial = { ...DEFAULT_OUTER, publicInputs: REAL_INPUTS };

const REAL_IDENTIFIER = BigInt(REAL_INPUTS[8]);

const REAL_PARAMS = { ...PARAMS, domain: 'zkpassport.id', scope: 'bigproof' };

const REFUSED = [
  'https://recover.example',
  'HTTPS://recover.example',
  'Recover.example',
  'recover.example/',
  'recover.example/a/b',
  'recover.example:443',
  ' recover.example',
  'recover.example?x=1',
  'recover.example#x',
  'İstanbul.example',
];

const ACCEPTED = ['recover.example', 'zkpassport.id', 'localhost', 'bücher.example'];

const CALLS = [
  ['enrollInput', (params: Params) => zkPassportMethod({ stack: stackDouble().stack }).enrollInput(params)],
  ['signingInput', (params: Params) => zkPassportMethod({ stack: stackDouble().stack }).signingInput(makeCtx(CONFIG), params)],
] as const;

describe('the copied rule is the installed peer\'s', () => {
  /** `@zkpassport/sdk` 0.17.1's built module, read as text, never run. */
  const peerSource = (): string => readFileSync(join(PACKAGE_ROOT, 'node_modules', '@zkpassport', 'sdk', 'dist', 'esm', 'index.js'), 'utf8');

  it('the constructor stores the normalized domain, by the copied steps in their order', () => {
    const source = peerSource();
    const body = `normalizeDomain(t){return t.trim()${PEER_DOMAIN_STEPS.map((step) => `.replace(${step.toString()},"")`).join('')}.toLowerCase()}`;

    expect(source).toContain(body);
    expect(source).toContain('this.domain=this.normalizeDomain(t||window.location.hostname)');
  });

  it('an explicit domain reaches the verifier parameters unchanged', () => {
    expect(peerSource()).toContain('domain:e??this.domain');
  });

  it.each([
    ['zkpassport.id/a/b', 'zkpassport.id/a'],
    ['HTTPS://zkpassport.id', 'https:/'],
    ['https://zkpassport.id/?a=b/c', 'zkpassport.id/'],
    ['https://zkpassport.id', 'zkpassport.id'],
    ['ZKPassport.id', 'zkpassport.id'],
  ])('the copy rewrites %s to %s, which it may rewrite again', (domain, stored) => {
    expect(peerDomain(domain)).toBe(stored);
  });
});

describe('the params calls take only a domain the stack keeps as given', () => {
  describe.each(CALLS)('%s', (_name, call) => {
    it.each(REFUSED)('refuses %j with a TypeError carrying the domain message', (domain) => {
      const error = thrown(() => call({ ...PARAMS, domain }));

      expect(peerDomain(domain)).not.toBe(domain);
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe(constants.METHOD_ZKPASSPORT_DOMAIN_MESSAGE);
    });

    it.each(ACCEPTED)('accepts %j, and its record carries it as given', (domain) => {
      expect(peerDomain(domain)).toBe(domain);
      expect(call({ ...PARAMS, domain })['domain']).toBe(domain);
    });

    it.each([
      ['an empty domain', { ...PARAMS, domain: '' }, constants.METHOD_ZKPASSPORT_SESSION_MESSAGE],
      ['no domain', { scope: PARAMS.scope }, constants.METHOD_ZKPASSPORT_SESSION_MESSAGE],
      ['a domain the stack rewrites beside an empty scope', { ...PARAMS, domain: 'HTTPS://x', scope: '' }, constants.METHOD_ZKPASSPORT_SESSION_MESSAGE],
      ['a domain the stack rewrites beside a name that is not text', { ...PARAMS, domain: 'HTTPS://x', name: 5 }, constants.METHOD_ZKPASSPORT_DOMAIN_MESSAGE],
      ['a kept domain beside a name that is not text', { ...PARAMS, name: 5 }, constants.METHOD_ZKPASSPORT_DISPLAY_MESSAGE],
    ])('answers %s with the TypeError of the first check it fails', (_why, params, message) => {
      const error = thrown(() => call(params as never));

      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe(message);
    });
  });

  it.each(REFUSED)('a refused %j asks the stack nothing', (domain) => {
    const double = stackDouble();
    const method = zkPassportMethod({ stack: double.stack });

    expect(() => method.enrollInput({ ...PARAMS, domain })).toThrow(TypeError);
    expect(() => method.signingInput(makeCtx(CONFIG), { ...PARAMS, domain })).toThrow(TypeError);
    expect(double.calls).toEqual([]);
  });

  it.each(ACCEPTED)('an accepted %j is the string the stack is built with, the verifier parameters receive and the config commits', async (domain) => {
    const double = stackDouble({ outer: outerFor(domain, PARAMS.scope) });
    const method = zkPassportMethod({ stack: double.stack });
    const input = method.enrollInput({ ...PARAMS, domain });

    await open(input);

    const config = await method.configFrom(input, enrollMaterial());

    expect(double.calls.filter((call) => call.kind === 'construct')).toEqual([
      { kind: 'construct', domain },
      { kind: 'construct', domain },
    ]);
    expect(verifierCalls(double.calls).map((call) => call.args.domain)).toEqual([domain]);
    expect(config).toBe(encodeConfig(word(IDENTIFIER), domain, PARAMS.scope, 604800n));
  });

  it('signingInput does not read the config: a config under another or a rewritten domain does not refuse the params', () => {
    for (const domain of ['other.example', 'https://recover.example']) {
      const double = stackDouble();
      const ctx = makeCtx(encodeConfig(word(IDENTIFIER), domain, PARAMS.scope, 604800n));

      expect(zkPassportMethod({ stack: double.stack }).signingInput(ctx, PARAMS)['domain']).toBe(PARAMS.domain);
      expect(double.calls).toEqual([]);
    }
  });
});

describe('the scope words, computed here with node:crypto', () => {
  it.each([
    ['zkpassport.id', REAL_INPUTS[3]],
    ['bigproof', REAL_INPUTS[4]],
    ['', word(0)],
  ])('%j gives the word a real outer proof carries for it', (text, expected) => {
    expect(scopeWord(text)).toBe(expected);
  });

  it('a scheme or a capital letter gives another word than the domain the proof was made for', () => {
    expect(scopeWord('https://zkpassport.id')).toBe('0x00b45346112ef137f58eadde0851d6a0dcd12f793037fa4e56b7238dc3167bfd');
    expect(scopeWord('ZKPassport.id')).toBe('0x004b89e30c0282bee0dbb83459588b6559fcf7b669789e3432ba6da97a9be479');
  });

  it('a real outer proof for zkpassport.id and bigproof enrolls, replies and is not judged', async () => {
    const double = stackDouble({ outer: REAL_OUTER });
    const method = zkPassportMethod({ stack: double.stack });
    const config = encodeConfig(word(REAL_IDENTIFIER), REAL_PARAMS.domain, REAL_PARAMS.scope, 604800n);
    const ctx = makeCtx(config);

    await expect(method.configFrom(method.enrollInput(REAL_PARAMS), enrollMaterial(REAL_IDENTIFIER))).resolves.toBe(config);
    await expect(method.replyFrom(ctx, method.signingInput(ctx, REAL_PARAMS), replyMaterial())).resolves.toBe(proofOf(REAL_OUTER));
    await expect(method.verify(ctx, proofOf(REAL_OUTER))).resolves.toBe('not-judged');
  });
});

const mismatches: readonly (readonly [string, OuterMaterial])[] = [
  ['word 3 is the domain\'s with a scheme', outerWith({ 3: scopeWord(`https://${PARAMS.domain}`) })],
  ['word 3 is another domain\'s', outerWith({ 3: scopeWord('other.example') })],
  ['word 3 is the zero word', outerWith({ 3: word(0) })],
  ['word 4 is another scope\'s', outerWith({ 4: scopeWord('other-scope') })],
  ['word 4 is the zero word', outerWith({ 4: word(0) })],
  ['words 3 and 4 are swapped', outerWith({ 3: scopeWord(PARAMS.scope), 4: scopeWord(PARAMS.domain) })],
  ['the inputs are seven, the first dropped', { ...DEFAULT_OUTER, publicInputs: outerInputs(IDENTIFIER).slice(1) }],
  ['the inputs are seven, the last dropped', { ...DEFAULT_OUTER, publicInputs: outerInputs(IDENTIFIER).slice(0, 7) }],
];

describe('the proof\'s words 3 and 4 must be the committed domain\'s and scope\'s', () => {
  it('a proof whose words are the session\'s writes the config of today', async () => {
    const method = zkPassportMethod({ stack: stackDouble().stack });

    await expect(method.configFrom(method.enrollInput(PARAMS), enrollMaterial())).resolves.toBe(CONFIG);
  });

  it.each(mismatches)('configFrom answers material-rejected where %s', async (_why, outer) => {
    const method = zkPassportMethod({ stack: stackDouble({ outer }).stack });

    await expect(method.configFrom(method.enrollInput(PARAMS), enrollMaterial())).resolves.toEqual(constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED);
  });

  it.each(mismatches)('replyFrom answers material-rejected where %s', async (_why, outer) => {
    const method = zkPassportMethod({ stack: stackDouble({ outer }).stack });
    const ctx = makeCtx(CONFIG);

    await expect(method.replyFrom(ctx, method.signingInput(ctx, PARAMS), replyMaterial())).resolves.toEqual(constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED);
  });

  it.each(mismatches)('verify answers rejected where %s, and asks the stack nothing', async (_why, outer) => {
    const double = stackDouble();

    await expect(zkPassportMethod({ stack: double.stack }).verify(makeCtx(CONFIG), proofOf(outer))).resolves.toBe('rejected');
    expect(double.calls).toEqual([]);
  });

  it('configFrom commits the session\'s domain and scope, not the stack\'s echo, and the echoed validity', async () => {
    const double = stackDouble({ serviceConfig: () => ({ validityPeriodInSeconds: 86400, domain: 'other.example', scope: 'other-scope', devMode: false }) });
    const method = zkPassportMethod({ stack: double.stack });

    await expect(method.configFrom(method.enrollInput(PARAMS), enrollMaterial())).resolves.toBe(
      encodeConfig(word(IDENTIFIER), PARAMS.domain, PARAMS.scope, 86400n),
    );
  });

  it('replyFrom refuses a proof made for the session where the session is not the config\'s domain and scope', async () => {
    const method = zkPassportMethod({ stack: stackDouble({ outer: outerFor('other.example', 'other-scope') }).stack });
    const ctx = makeCtx(CONFIG);

    await expect(method.replyFrom(ctx, method.signingInput(ctx, { ...PARAMS, domain: 'other.example', scope: 'other-scope' }), replyMaterial())).resolves.toEqual(
      constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED,
    );
  });

  it('replyFrom refuses a proof made for the session where the config commits another canonical domain', async () => {
    const method = zkPassportMethod({ stack: stackDouble().stack });
    const ctx = makeCtx(encodeConfig(word(IDENTIFIER), 'other.example', PARAMS.scope, 604800n));

    await expect(method.replyFrom(ctx, method.signingInput(ctx, PARAMS), replyMaterial())).resolves.toEqual(constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED);
  });

  it('replyFrom compares the proof\'s words with the config, not the session with the config', async () => {
    const method = zkPassportMethod({ stack: stackDouble().stack });
    const ctx = makeCtx(CONFIG);

    await expect(method.replyFrom(ctx, method.signingInput(ctx, { ...PARAMS, domain: 'other.example' }), replyMaterial())).resolves.toBe(proofOf(DEFAULT_OUTER));
  });
});

describe('a committed config this build can never serve answers request-unsupported before the stack is asked', () => {
  it.each([
    ['a domain with a scheme', `https://${PARAMS.domain}`, PARAMS.scope],
    ['a domain with a capital letter', 'Recover.example', PARAMS.scope],
    ['a domain ending in a slash', `${PARAMS.domain}/`, PARAMS.scope],
    ['an empty domain', '', PARAMS.scope],
    ['an empty scope', PARAMS.domain, ''],
    ['an empty domain and scope', '', ''],
  ])('replyFrom answers the frozen request-unsupported record for a config with %s', async (_why, domain, scope) => {
    const double = stackDouble({ outer: outerFor(domain, scope) });
    const method = zkPassportMethod({ stack: double.stack });
    const ctx = makeCtx(encodeConfig(word(IDENTIFIER), domain, scope, 604800n));
    const answer = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), replyMaterial());

    expect(answer).toEqual({ kind: 'reply-failure', cause: 'request-unsupported' });
    expect(answer).toEqual(constants.METHOD_ZKPASSPORT_REQUEST_UNSUPPORTED);
    expect(Object.isFrozen(answer)).toBe(true);
    expect(double.calls).toEqual([]);
  });

  it.each([`https://${PARAMS.domain}`, 'Recover.example', `${PARAMS.domain}:443`])('replyFrom answers material-rejected for an input record whose domain is %j, and asks the stack nothing', async (domain) => {
    const double = stackDouble();
    const method = zkPassportMethod({ stack: double.stack });
    const ctx = makeCtx(CONFIG);

    await expect(method.replyFrom(ctx, { ...method.signingInput(ctx, PARAMS), domain }, replyMaterial())).resolves.toEqual(
      constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED,
    );
    expect(double.calls).toEqual([]);
  });
});

describe('a URL-style or capitalised domain can no longer commit a credential that never approves', () => {
  it.each(['https://zkpassport.id', 'ZKPassport.id'])('enrollInput and signingInput refuse %j, which the stack would rewrite to zkpassport.id', (domain) => {
    const method = zkPassportMethod({ stack: stackDouble({ outer: REAL_OUTER }).stack });

    expect(peerDomain(domain)).toBe(REAL_PARAMS.domain);
    expect(thrown(() => method.enrollInput({ ...REAL_PARAMS, domain }))).toBeInstanceOf(TypeError);
    expect(thrown(() => method.signingInput(makeCtx(CONFIG), { ...REAL_PARAMS, domain }))).toBeInstanceOf(TypeError);
  });

  it.each(['https://zkpassport.id', 'ZKPassport.id'])('configFrom does not commit %j for a proof made for zkpassport.id, and asks the stack nothing', async (domain) => {
    const double = stackDouble({ outer: REAL_OUTER });
    const input: EnrollInput = { kind: 'ceremony', domain, scope: REAL_PARAMS.scope };

    await expect(zkPassportMethod({ stack: double.stack }).configFrom(input, enrollMaterial(REAL_IDENTIFIER))).resolves.toEqual(
      constants.METHOD_ZKPASSPORT_MATERIAL_REJECTED,
    );
    expect(double.calls).toEqual([]);
  });

  it.each(['https://zkpassport.id', 'ZKPassport.id'])('a config already committed under %j answers request-unsupported at replyFrom and rejected at verify', async (domain) => {
    const double = stackDouble({ outer: REAL_OUTER });
    const method = zkPassportMethod({ stack: double.stack });
    const ctx = makeCtx(encodeConfig(word(REAL_IDENTIFIER), domain, REAL_PARAMS.scope, 604800n));

    await expect(method.replyFrom(ctx, method.signingInput(ctx, REAL_PARAMS), replyMaterial())).resolves.toEqual(constants.METHOD_ZKPASSPORT_REQUEST_UNSUPPORTED);
    await expect(method.verify(ctx, proofOf(REAL_OUTER))).resolves.toBe('rejected');
    expect(double.calls).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { EnrollInput, Hex, Input, Material, ReplyFailure } from '../../src/interfaces';
import { readVector } from '../kat/read-vector';
import {
  asHex,
  asText,
  CALLBACK_NAMES,
  DEFAULT_OUTER,
  DIGEST,
  encodeConfig,
  encodeProof,
  IDENTIFIER,
  makeCtx,
  member,
  outerInputs,
  PARAMS,
  stackDouble,
  stackProof,
  word,
  type OuterMaterial,
  type StackCall,
} from './fixtures';

type Opened = { readonly url: unknown; readonly [name: string]: unknown };

const open = async (record: EnrollInput | Input): Promise<Opened> =>
  (record['openRequest'] as () => Promise<Opened>)();

const REQUEST_ARGS = {
  name: PARAMS.name,
  logo: PARAMS.logo,
  purpose: PARAMS.purpose,
  scope: PARAMS.scope,
  mode: 'compressed-evm',
  devMode: false,
};

const rejected: ReplyFailure = { kind: 'reply-failure', cause: 'material-rejected' };

/** The config the default outer proof's identifier commits to under PARAMS, encoded independently. */
const CONFIG = encodeConfig(word(IDENTIFIER), asHex(DEFAULT_OUTER.version), PARAMS.domain, PARAMS.scope, 604800n);

const enrollMaterial = (overrides: { readonly [k: string]: unknown } = {}): Material => ({
  result: {
    verified: true,
    uniqueIdentifier: IDENTIFIER.toString(10),
    proofs: [stackProof('sig_check_dsc'), stackProof('outer_evm_count_4')],
    ...overrides,
  },
});

/** Proofs as the page receives them; `null` for an outer proof that bound no custom data. */
const replyMaterial = (customData: string | null = DIGEST): Material => ({
  proofs: [stackProof('disclose_bytes_evm', customData ?? undefined), stackProof('outer_evm_count_5', customData ?? undefined)],
});

const verifierCalls = (calls: readonly StackCall[]) => calls.filter((call) => call.kind === 'verifier-parameters');

describe('enrollment: enrollInput(params) and configFrom(input, { result })', () => {
  it('enrollInput acts on nothing: the stack is not reached until the page opens the request', () => {
    const double = stackDouble();
    const input = zkPassportMethod(double.stack).enrollInput(PARAMS);

    expect(input.kind).toBe('ceremony');
    expect(input['domain']).toBe(PARAMS.domain);
    expect(input['scope']).toBe(PARAMS.scope);
    expect(typeof input['openRequest']).toBe('function');
    expect(double.calls).toEqual([]);
  });

  it('opening the request constructs the stack for the domain and requests under the scope, compressed-evm, dev mode off', async () => {
    const double = stackDouble();
    const request = await open(zkPassportMethod(double.stack).enrollInput(PARAMS));

    expect(double.calls[0]).toEqual({ kind: 'construct', domain: PARAMS.domain });
    expect(double.calls[1]).toEqual({ kind: 'request', domain: PARAMS.domain, args: REQUEST_ARGS });
    expect(double.calls.at(-1)).toEqual({ kind: 'done', domain: PARAMS.domain });
    expect(double.calls.filter((call) => call.kind === 'bind').every((call) => call.value !== DIGEST)).toBe(true);
    expect(typeof request.url).toBe('string');
    expect(String(request.url)).toContain(encodeURIComponent(PARAMS.scope));
  });

  it('the opened request is the double\'s result: the url and the six callbacks of the stack request', async () => {
    const double = stackDouble();
    const request = await open(zkPassportMethod(double.stack).enrollInput(PARAMS));

    for (const name of CALLBACK_NAMES) expect(typeof request[name]).toBe('function');

    (request['onSuccess'] as (cb: () => void) => void)(() => undefined);
    expect(double.calls.at(-1)).toEqual({ kind: 'callback', domain: PARAMS.domain, name: 'onSuccess' });
  });

  it('configFrom writes the identity commitment as the config, under the input\'s domain and scope', async () => {
    const double = stackDouble();
    const method = zkPassportMethod(double.stack);
    const input = method.enrollInput(PARAMS);
    const config = await method.configFrom(input, enrollMaterial());

    expect(config).toBe(CONFIG);

    const decoded = method.codec.decodeConfig(config as Hex);

    expect(decoded['uniqueIdentifier']).toBe(word(IDENTIFIER));
    expect(decoded['domain']).toBe(PARAMS.domain);
    expect(decoded['scope']).toBe(PARAMS.scope);
  });

  it('configFrom hands the outer_evm proof to getSolidityVerifierParameters with the domain and scope off the input, dev mode off', async () => {
    const double = stackDouble();
    const method = zkPassportMethod(double.stack);
    const material = enrollMaterial();
    const outer = (member(material, 'result', 'proofs') as unknown[])[1];

    await method.configFrom(method.enrollInput(PARAMS), material);

    expect(double.calls.filter((call) => call.kind === 'construct')).toEqual([{ kind: 'construct', domain: PARAMS.domain }]);
    expect(verifierCalls(double.calls)).toHaveLength(1);
    expect(verifierCalls(double.calls)[0]?.args).toEqual({ proof: outer, scope: PARAMS.scope, domain: PARAMS.domain, devMode: false });
    expect((verifierCalls(double.calls)[0]?.args as { proof: unknown }).proof).toBe(outer);
  });

  it('configFrom reads the domain and the scope off the input rather than taking them again', async () => {
    const double = stackDouble();
    const method = zkPassportMethod(double.stack);
    const input: EnrollInput = { ...method.enrollInput(PARAMS), domain: 'other.example', scope: 'other-scope' };
    const config = await method.configFrom(input, enrollMaterial());

    expect(verifierCalls(double.calls)[0]).toMatchObject({ domain: 'other.example', args: { domain: 'other.example', scope: 'other-scope' } });
    expect(method.codec.decodeConfig(config as Hex)).toMatchObject({ domain: 'other.example', scope: 'other-scope' });
  });

  it('a different scope derives a different config for the same result', async () => {
    const method = zkPassportMethod(stackDouble().stack);
    const a = await method.configFrom(method.enrollInput(PARAMS), enrollMaterial());
    const b = await method.configFrom(method.enrollInput({ ...PARAMS, scope: 'another' }), enrollMaterial());

    expect(a).not.toBe(b);
  });

  it.each<[string, Material, OuterMaterial | undefined]>([
    ['no material', undefined, undefined],
    ['a material without result', {}, undefined],
    ['a result that is not a record', { result: 'ok' }, undefined],
    ['a result that did not verify', enrollMaterial({ verified: false }), undefined],
    ['a result whose verified flag is truthy but not true', enrollMaterial({ verified: 'true' }), undefined],
    ['no outer_evm proof among the proofs', enrollMaterial({ proofs: [stackProof('disclose_bytes')] }), undefined],
    ['proofs that are not a list', enrollMaterial({ proofs: 'outer_evm' }), undefined],
    ['a missing identifier', enrollMaterial({ uniqueIdentifier: undefined }), undefined],
    ['a non-decimal identifier', enrollMaterial({ uniqueIdentifier: '0x12' }), undefined],
    ['a zero identifier', enrollMaterial({ uniqueIdentifier: '0' }), { ...DEFAULT_OUTER, publicInputs: outerInputs(0n) }],
    ['an identifier that is not the outer proof\'s scoped nullifier', enrollMaterial({ uniqueIdentifier: '99' }), undefined],
    ['a salted nullifier (type 1)', enrollMaterial(), { ...DEFAULT_OUTER, publicInputs: outerInputs(IDENTIFIER, 1n) }],
    ['a dev-mode mock nullifier (type 2)', enrollMaterial(), { ...DEFAULT_OUTER, publicInputs: outerInputs(IDENTIFIER, 2n) }],
    ['a dev-mode mock nullifier (type 3)', enrollMaterial(), { ...DEFAULT_OUTER, publicInputs: outerInputs(IDENTIFIER, 3n) }],
    ['too few public inputs', enrollMaterial(), { ...DEFAULT_OUTER, publicInputs: [word(IDENTIFIER)] }],
  ])('configFrom answers the typed EnrollFailure for %s, never a throw', async (_why, material, outer) => {
    const method = zkPassportMethod(stackDouble(outer === undefined ? {} : { outer }).stack);

    await expect(method.configFrom(method.enrollInput(PARAMS), material)).resolves.toEqual(rejected);
  });

  it('configFrom answers EnrollFailure when the stack reports dev mode in the service config', async () => {
    const double = stackDouble({ serviceConfig: (args) => ({ validityPeriodInSeconds: 1, domain: args.domain, scope: args.scope, devMode: true }) });
    const method = zkPassportMethod(double.stack);

    await expect(method.configFrom(method.enrollInput(PARAMS), enrollMaterial())).resolves.toEqual(rejected);
  });

  it('configFrom answers EnrollFailure when the stack refuses the proof', async () => {
    const method = zkPassportMethod(stackDouble({ verifierThrows: true }).stack);

    await expect(method.configFrom(method.enrollInput(PARAMS), enrollMaterial())).resolves.toEqual(rejected);
  });

  it('configFrom answers a typed failure, device-unavailable, when the stack cannot load', async () => {
    const method = zkPassportMethod(stackDouble({ constructThrows: true }).stack);

    await expect(method.configFrom(method.enrollInput(PARAMS), enrollMaterial())).resolves.toEqual({
      kind: 'reply-failure',
      cause: 'device-unavailable',
    });
  });

  it.each<[string, EnrollInput]>([
    ['an input with nothing to perform', { kind: 'nothing-to-perform', domain: PARAMS.domain, scope: PARAMS.scope }],
    ['a ceremony input without a domain', { kind: 'ceremony', scope: PARAMS.scope }],
    ['a ceremony input without a scope', { kind: 'ceremony', domain: PARAMS.domain }],
    ['a ceremony input with a numeric scope', { kind: 'ceremony', domain: PARAMS.domain, scope: 7 }],
  ])('configFrom answers EnrollFailure for %s, and asks the stack nothing', async (_why, input) => {
    const double = stackDouble();

    await expect(zkPassportMethod(double.stack).configFrom(input, enrollMaterial())).resolves.toEqual(rejected);
    expect(double.calls).toEqual([]);
  });

  it.each([
    ['no params', undefined],
    ['no domain', { scope: PARAMS.scope }],
    ['an empty scope', { domain: PARAMS.domain, scope: '' }],
    ['a name that is not text', { ...PARAMS, name: 5 }],
  ])('enrollInput refuses %s (an orchestrator-side refusal throws)', (_why, params) => {
    expect(() => zkPassportMethod(stackDouble().stack).enrollInput(params as never)).toThrow();
  });
});

describe('approval: signingInput(ctx, params) and replyFrom(ctx, input, { proofs })', () => {
  it('signingInput acts on nothing; opening binds the digest under the params\' domain and scope', async () => {
    const double = stackDouble();
    const input = zkPassportMethod(double.stack).signingInput(makeCtx(CONFIG), PARAMS);

    expect(double.calls).toEqual([]);

    const request = await open(input);

    expect(double.calls.slice(0, 4)).toEqual([
      { kind: 'construct', domain: PARAMS.domain },
      { kind: 'request', domain: PARAMS.domain, args: REQUEST_ARGS },
      { kind: 'bind', domain: PARAMS.domain, key: 'custom_data', value: DIGEST },
      { kind: 'done', domain: PARAMS.domain },
    ]);
    expect(typeof request.url).toBe('string');
  });

  it('a different scope yields a different request, and a different domain another stack instance', async () => {
    const a = stackDouble();
    const b = stackDouble();
    const c = stackDouble();

    await open(zkPassportMethod(a.stack).signingInput(makeCtx(CONFIG), PARAMS));
    await open(zkPassportMethod(b.stack).signingInput(makeCtx(CONFIG), { ...PARAMS, scope: 'another-scope' }));
    await open(zkPassportMethod(c.stack).signingInput(makeCtx(CONFIG), { ...PARAMS, domain: 'another.example' }));

    expect(a.calls[1]).toMatchObject({ args: { scope: PARAMS.scope } });
    expect(b.calls[1]).toMatchObject({ args: { scope: 'another-scope' } });
    expect(a.calls[1]).not.toEqual(b.calls[1]);
    expect(c.calls[0]).toEqual({ kind: 'construct', domain: 'another.example' });
  });

  it('the name, logo and purpose reach the request as given, and nothing else rides along', async () => {
    const double = stackDouble();

    await open(zkPassportMethod(double.stack).signingInput(makeCtx(CONFIG), { ...PARAMS, unknownParam: 'x' }));

    expect((double.calls[1] as { args: unknown }).args).toEqual(REQUEST_ARGS);
  });

  it('replyFrom packages the verifier parameters of the outer_evm proof as the proof layout', async () => {
    const double = stackDouble();
    const method = zkPassportMethod(double.stack);
    const ctx = makeCtx(CONFIG);
    const proof = await method.replyFrom(ctx, method.signingInput(ctx, PARAMS), replyMaterial());

    expect(proof).toBe(
      encodeProof(asHex(DEFAULT_OUTER.vkeyHash), asHex(DEFAULT_OUTER.proof), DEFAULT_OUTER.publicInputs.map(asHex), asHex(DEFAULT_OUTER.committedInputs)),
    );
    expect(verifierCalls(double.calls)[0]?.args).toMatchObject({ scope: PARAMS.scope, domain: PARAMS.domain, devMode: false });
    expect((verifierCalls(double.calls)[0]?.args.proof as { name: string }).name).toBe('outer_evm_count_5');
  });

  it('replyFrom reads the domain and the scope off the input', async () => {
    const double = stackDouble();
    const method = zkPassportMethod(double.stack);
    const ctx = makeCtx(CONFIG);
    const input: Input = { ...method.signingInput(ctx, PARAMS), domain: 'other.example', scope: 'other-scope' };

    await method.replyFrom(ctx, input, replyMaterial());

    expect(verifierCalls(double.calls)[0]).toMatchObject({ domain: 'other.example', args: { domain: 'other.example', scope: 'other-scope' } });
  });

  it.each<[string, Material, OuterMaterial | undefined]>([
    ['no material', undefined, undefined],
    ['proofs that are not a list', { proofs: {} }, undefined],
    ['no outer_evm proof among the proofs', { proofs: [stackProof('outer_fast', DIGEST), stackProof('disclose', DIGEST)] }, undefined],
    ['bound data that is another digest', replyMaterial(word(1)), undefined],
    ['bound data that is the digest upper-cased', replyMaterial(`0x${DIGEST.slice(2).toUpperCase()}`), undefined],
    ['bound data that is the digest without 0x', replyMaterial(DIGEST.slice(2)), undefined],
    ['no bound data', replyMaterial(null), undefined],
    ['a unique identifier that is not the config\'s', replyMaterial(), { ...DEFAULT_OUTER, publicInputs: outerInputs(IDENTIFIER + 1n) }],
  ])('replyFrom answers the typed ReplyFailure for %s, never a throw', async (_why, material, outer) => {
    const method = zkPassportMethod(stackDouble(outer === undefined ? {} : { outer }).stack);
    const ctx = makeCtx(CONFIG);

    await expect(method.replyFrom(ctx, method.signingInput(ctx, PARAMS), material)).resolves.toEqual(rejected);
  });

  it('replyFrom answers ReplyFailure where the stack refuses the proof, and device-unavailable where it cannot load', async () => {
    const ctx = makeCtx(CONFIG);
    const refusing = zkPassportMethod(stackDouble({ verifierThrows: true }).stack);
    const absent = zkPassportMethod(stackDouble({ constructThrows: true }).stack);

    await expect(refusing.replyFrom(ctx, refusing.signingInput(ctx, PARAMS), replyMaterial())).resolves.toEqual(rejected);
    await expect(absent.replyFrom(ctx, absent.signingInput(ctx, PARAMS), replyMaterial())).resolves.toEqual({
      kind: 'reply-failure',
      cause: 'device-unavailable',
    });
  });

  it.each<[string, Input, Hex]>([
    ['an input without a domain', { scope: PARAMS.scope }, CONFIG],
    ['an input without a scope', { domain: PARAMS.domain }, CONFIG],
    ['a config that is not the layout', { domain: PARAMS.domain, scope: PARAMS.scope }, word(IDENTIFIER)],
    ['an empty config', { domain: PARAMS.domain, scope: PARAMS.scope }, '0x'],
  ])('replyFrom answers ReplyFailure for %s, never a throw', async (_why, input, config) => {
    const method = zkPassportMethod(stackDouble().stack);

    await expect(method.replyFrom(makeCtx(config), input, replyMaterial())).resolves.toEqual(rejected);
  });
});

const proofFile = readVector('method-zkpassport-proof.json');
const configFile = readVector('method-zkpassport-config.json');

describe('the ceremony reproduces the blessed rows', () => {
  const configRow = configFile.vectors[0];
  const proofRow = proofFile.vectors[0];

  const rowOuter = (): OuterMaterial => ({
    version: asText(member(configRow, 'input', 'version')),
    vkeyHash: asText(member(proofRow, 'input', 'proofVerificationData', 'vkeyHash')),
    proof: asText(member(proofRow, 'input', 'proofVerificationData', 'proof')),
    publicInputs: (member(proofRow, 'input', 'proofVerificationData', 'publicInputs') as unknown[]).map(asText),
    committedInputs: asText(member(proofRow, 'input', 'committedInputs')),
    validityPeriodInSeconds: Number(asText(member(configRow, 'input', 'validityPeriodInSeconds'))),
  });

  const params = () => ({ ...PARAMS, domain: asText(member(configRow, 'input', 'domain')), scope: asText(member(configRow, 'input', 'scope')) });

  it('configFrom writes the config row byte for byte when the stack answers the row\'s values', async () => {
    const method = zkPassportMethod(stackDouble({ outer: rowOuter() }).stack);
    const identifier = BigInt(asHex(member(configRow, 'input', 'uniqueIdentifier'))).toString(10);

    await expect(method.configFrom(method.enrollInput(params()), enrollMaterial({ uniqueIdentifier: identifier }))).resolves.toBe(
      asHex(member(configRow, 'expected', 'encoded')),
    );
  });

  it('replyFrom writes the proof row byte for byte for the row\'s digest', async () => {
    const method = zkPassportMethod(stackDouble({ outer: rowOuter() }).stack);
    const digest = asHex(member(proofRow, 'input', 'digest'));
    const ctx = makeCtx(asHex(member(configRow, 'expected', 'encoded')), digest);
    const required = asText(member(proofRow, 'expected', 'requiredCustomData'));

    await expect(method.replyFrom(ctx, method.signingInput(ctx, params()), replyMaterial(required))).resolves.toBe(
      asHex(member(proofRow, 'expected', 'encoded')),
    );
  });
});

import { describe, expect, it } from 'vitest';
import { zkPassportMethod } from '../../src/method-zkpassport';
import type { EnrollInput, Hex, Input, Material, ReplyFailure } from '../../src/interfaces';
import {
  asHex,
  DEFAULT_OUTER,
  DIGEST,
  encodeConfig,
  encodeProof,
  IDENTIFIER,
  makeCtx,
  outerInputs,
  PARAMS,
  stackDouble,
  stackProof,
  word,
  type OuterMaterial,
  type StackCall,
  type StackDoubleOptions,
} from './fixtures';

type Opened = { readonly requestId: unknown; readonly [name: string]: unknown };

const open = async (record: EnrollInput | Input): Promise<Opened> =>
  (record['openRequest'] as () => Promise<Opened>)();

const MODES = [false, true] as const;

const rejected: ReplyFailure = { kind: 'reply-failure', cause: 'material-rejected' };

const CONFIG = encodeConfig(word(IDENTIFIER), PARAMS.domain, PARAMS.scope, 604800n);

const requestArgs = (devMode: boolean) => ({
  name: PARAMS.name,
  logo: PARAMS.logo,
  purpose: PARAMS.purpose,
  scope: PARAMS.scope,
  mode: 'compressed-evm',
  devMode,
});

const ENROLL_OUTER = stackProof('outer_evm_count_4');

const enrollMaterial = (): Material => ({
  result: { verified: true, uniqueIdentifier: IDENTIFIER.toString(10), proofs: [stackProof('sig_check_dsc'), ENROLL_OUTER] },
});

const replyMaterial = (): Material => ({
  proofs: [stackProof('disclose_bytes_evm', DIGEST), stackProof('outer_evm_count_5', DIGEST)],
});

const outerWith = (publicInputs: readonly string[]): OuterMaterial => ({ ...DEFAULT_OUTER, publicInputs });

const proofOf = (outer: OuterMaterial): Hex =>
  encodeProof(asHex(outer.vkeyHash), asHex(outer.proof), outer.publicInputs.map(asHex), asHex(outer.committedInputs));

const verifierCalls = (calls: readonly StackCall[]) => calls.filter((call) => call.kind === 'verifier-parameters');

const build = (devMode: boolean, options: StackDoubleOptions = {}) => {
  const double = stackDouble(options);

  return { double, method: zkPassportMethod({ stack: double.stack, devMode }) };
};

describe('the factory takes an options record', () => {
  it('zkPassportMethod({}) and zkPassportMethod() verify alike without loading a stack, dev mode off', async () => {
    const proof = proofOf(outerWith(outerInputs(IDENTIFIER)));
    const mock = proofOf(outerWith(outerInputs(IDENTIFIER, 2n)));

    for (const method of [zkPassportMethod({}), zkPassportMethod()]) {
      expect(method.enrollInput(PARAMS).kind).toBe('ceremony');
      await expect(method.verify(makeCtx(CONFIG), proof)).resolves.toBe('not-judged');
      await expect(method.verify(makeCtx(CONFIG), mock)).resolves.toBe('rejected');
    }
  });

  it('zkPassportMethod({ devMode: true }) without a stack verifies a mock proof locally', async () => {
    await expect(zkPassportMethod({ devMode: true }).verify(makeCtx(CONFIG), proofOf(outerWith(outerInputs(IDENTIFIER, 2n))))).resolves.toBe('not-judged');
  });

  it('an explicit devMode: false behaves as the default', async () => {
    const double = stackDouble();

    await open(zkPassportMethod({ stack: double.stack, devMode: false }).enrollInput(PARAMS));

    expect(double.calls[1]).toEqual({ kind: 'request', domain: PARAMS.domain, args: requestArgs(false) });
  });
});

describe.each(MODES)('dev mode %s: the request and the verifier-parameter call carry the mode', (devMode) => {
  it('the enrollment request carries the mode', async () => {
    const { double, method } = build(devMode);

    await open(method.enrollInput(PARAMS));

    expect(double.calls[1]).toEqual({ kind: 'request', domain: PARAMS.domain, args: requestArgs(devMode) });
  });

  it('the approval request carries the mode and still binds the digest', async () => {
    const { double, method } = build(devMode);

    await open(method.signingInput(makeCtx(CONFIG), PARAMS));

    expect(double.calls.slice(1, 3)).toEqual([
      { kind: 'request', domain: PARAMS.domain, args: requestArgs(devMode) },
      { kind: 'bind', domain: PARAMS.domain, key: 'custom_data', value: DIGEST },
    ]);
  });

  it('configFrom and replyFrom ask for the verifier parameters in the mode', async () => {
    const { double, method } = build(devMode);
    const ctx = makeCtx(CONFIG);

    await expect(method.configFrom(method.enrollInput(PARAMS), enrollMaterial())).resolves.toBe(CONFIG);
    await expect(method.replyFrom(ctx, method.signingInput(ctx, PARAMS), replyMaterial())).resolves.toBe(proofOf(DEFAULT_OUTER));

    const calls = verifierCalls(double.calls);

    expect(calls).toHaveLength(2);
    expect(calls.map((call) => call.args.devMode)).toEqual([devMode, devMode]);
  });

  it('a stack echoing the other mode is material-rejected at enrollment and at the reply', async () => {
    const other = { serviceConfig: (args: { domain: string; scope: string }) => ({ validityPeriodInSeconds: 604800, domain: args.domain, scope: args.scope, devMode: !devMode }) };
    const { method } = build(devMode, other);
    const ctx = makeCtx(CONFIG);

    await expect(method.configFrom(method.enrollInput(PARAMS), enrollMaterial())).resolves.toEqual(rejected);
    await expect(method.replyFrom(ctx, method.signingInput(ctx, PARAMS), replyMaterial())).resolves.toEqual(rejected);
  });
});

/** The public inputs one case puts in the outer proof, and whether each mode accepts them. */
const NULLIFIER_CASES: readonly (readonly [string, readonly string[], { readonly off: boolean; readonly on: boolean }])[] = [
  ['type 0, a real document', outerInputs(IDENTIFIER, 0n), { off: true, on: true }],
  ['type 1, salted', outerInputs(IDENTIFIER, 1n), { off: false, on: false }],
  ['type 2, the app\'s fake passport', outerInputs(IDENTIFIER, 2n), { off: false, on: true }],
  ['type 3, a salted mock', outerInputs(IDENTIFIER, 3n), { off: false, on: false }],
  ['type 4, none', outerInputs(IDENTIFIER, 4n), { off: false, on: false }],
  ['too few public inputs to hold a type', [word(IDENTIFIER), word(0x24)], { off: false, on: false }],
];

describe.each(MODES)('dev mode %s: the nullifier types the method accepts', (devMode) => {
  it.each(NULLIFIER_CASES)('%s: configFrom, replyFrom and verify agree', async (_why, publicInputs, accepts) => {
    const accepted = devMode ? accepts.on : accepts.off;
    const outer = outerWith(publicInputs);
    const { double, method } = build(devMode, { outer });
    const ctx = makeCtx(CONFIG);

    await expect(method.configFrom(method.enrollInput(PARAMS), enrollMaterial())).resolves.toEqual(accepted ? CONFIG : rejected);
    await expect(method.replyFrom(ctx, method.signingInput(ctx, PARAMS), replyMaterial())).resolves.toEqual(accepted ? proofOf(outer) : rejected);

    const before = double.calls.length;

    await expect(method.verify(ctx, proofOf(outer))).resolves.toBe(accepted ? 'not-judged' : 'rejected');
    expect(double.calls).toHaveLength(before);
  });
});

describe.each(MODES)('dev mode %s: configFrom reads the proofs from either material shape', (devMode) => {
  const result = { verified: true, uniqueIdentifier: IDENTIFIER.toString(10) };
  const proofs = [stackProof('sig_check_dsc'), ENROLL_OUTER];

  it('the onResult payload, proofs inside the result, enrolls the config', async () => {
    const { method } = build(devMode);

    await expect(method.configFrom(method.enrollInput(PARAMS), { result: { ...result, proofs } })).resolves.toBe(CONFIG);
  });

  it('the verify() result beside the onSuccess proofs enrolls the same config', async () => {
    const { double, method } = build(devMode);

    await expect(method.configFrom(method.enrollInput(PARAMS), { result, proofs })).resolves.toBe(CONFIG);
    expect(verifierCalls(double.calls)[0]?.args.proof).toBe(ENROLL_OUTER);
  });

  it('proofs in neither place are material-rejected', async () => {
    const { method } = build(devMode);

    await expect(method.configFrom(method.enrollInput(PARAMS), { result })).resolves.toEqual(rejected);
  });

  it('the shape B result still needs verified: true and the identifier', async () => {
    const { method } = build(devMode);
    const input = method.enrollInput(PARAMS);

    await expect(method.configFrom(input, { result: { ...result, verified: false }, proofs })).resolves.toEqual(rejected);
    await expect(method.configFrom(input, { result: { verified: true }, proofs })).resolves.toEqual(rejected);
    await expect(method.configFrom(input, { proofs })).resolves.toEqual(rejected);
  });

  it('with proofs in both places, the result\'s proofs are the ones read', async () => {
    const { double, method } = build(devMode);
    const inner = stackProof('outer_evm_count_4');
    const outside = stackProof('outer_evm_count_9');

    await expect(method.configFrom(method.enrollInput(PARAMS), { result: { ...result, proofs: [inner] }, proofs: [outside] })).resolves.toBe(CONFIG);
    expect(verifierCalls(double.calls).map((call) => call.args.proof)).toEqual([inner]);
  });

  it('a null result list beside a valid outside list is refused, not read as absence', async () => {
    const { double, method } = build(devMode);
    const before = verifierCalls(double.calls).length;

    await expect(method.configFrom(method.enrollInput(PARAMS), { result: { ...result, proofs: null }, proofs })).resolves.toEqual(rejected);
    expect(verifierCalls(double.calls).length).toBe(before);
  });

  it('with proofs in both places, a result list without an outer proof is refused, not completed from outside', async () => {
    const { method } = build(devMode);

    await expect(
      method.configFrom(method.enrollInput(PARAMS), { result: { ...result, proofs: [stackProof('sig_check_dsc')] }, proofs }),
    ).resolves.toEqual(rejected);
  });
});

describe.each(MODES)('dev mode %s: the opened record', (devMode) => {
  const records = [
    ['enrollment', (method: ReturnType<typeof zkPassportMethod>) => method.enrollInput(PARAMS)],
    ['approval', (method: ReturnType<typeof zkPassportMethod>) => method.signingInput(makeCtx(CONFIG), PARAMS)],
  ] as const;

  it.each(records)('%s: cancel() asks the client to cancel the record\'s request, once', async (_which, recordOf) => {
    const { double, method } = build(devMode);
    const request = await open(recordOf(method));
    const before = double.calls.length;

    expect(typeof request['cancel']).toBe('function');
    expect(typeof request.requestId).toBe('string');

    (request['cancel'] as () => void)();

    expect(double.calls.slice(before)).toEqual([{ kind: 'cancel', domain: PARAMS.domain, requestId: request.requestId }]);
  });

  it.each(['onResult', 'onBridgeConnect', 'onBridgeConnectionLost'])('the record registers %s on the stack request', async (name) => {
    const { double, method } = build(devMode);
    const request = await open(method.enrollInput(PARAMS));

    (request[name] as (callback: () => void) => void)(() => undefined);

    expect(double.calls.at(-1)).toEqual({ kind: 'callback', domain: PARAMS.domain, name });
  });
});

import { decodeFunctionData, encodeErrorResult, encodeFunctionData, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import * as entry from '../../src/index';
import {
  POLICY_MANAGER_WRITES_ABI,
  RECOVERY_ACTION_IMPLEMENTATION_ABI,
  type Address,
  type Hex,
  type PreparedBatch,
  type PrepareOptions,
  type ValidationResult,
} from '../../src/index';
import { selectorOf } from '../helpers/keccak';
import {
  ACCOUNT,
  ACTION,
  addressWord,
  answeringHandler,
  ARMING_DATA,
  build,
  type BuildOptions,
  DESCRIPTOR,
  DRAFT,
  IMPLEMENTATION_SELECTOR,
  members,
  OTHER_ACTION,
  PIN,
  referenceCommitment,
  revert,
  transportFailure,
  withBackup,
  type Answer,
  type Seen,
} from './doubles';

const ZERO: Address = '0x0000000000000000000000000000000000000000';
const SERVED = DESCRIPTOR.servedImplementation;
const OTHER_IMPLEMENTATION: Address = getAddress(`0x${'b9'.repeat(20)}`);
const HANDLER_WORD: Hex = `0x${'00'.repeat(12)}${'69'.repeat(20)}`;
const EMPTY_DRAFT = withBackup(DRAFT, 'empty');

const READS = ['validateSetup', 'describeSetup'] as const;

/** A code-less account whose configuration declares the given implementation, the served one by default. */
const declaredCodeLess = (world: BuildOptions['world'] = {}, accountImplementation: Address = SERVED): BuildOptions => ({
  world: { code: '0x', ...world },
  configuration: { accountImplementation },
});

/** The `AMBIRE_IMPLEMENTATION()` calls the provider double saw, in order. */
const implementationCalls = (seen: Seen) => seen.calls.filter((call) => call.data.slice(0, 10).toLowerCase() === IMPLEMENTATION_SELECTOR);

/** The calls the provider double saw that target the account or run from it. */
const accountCalls = (seen: Seen) =>
  seen.calls.filter((call) => call.to.toLowerCase() === ACCOUNT.toLowerCase() || call.from.toLowerCase() === ACCOUNT.toLowerCase());

const fitFindings = (result: ValidationResult) =>
  [...result.errors, ...result.warnings].filter((finding) => ['account.deploy-pending', 'account.not-deployed', 'action.unsupported'].includes(finding.code));

/** The revert `commitSetup` answers for an action that does not serve the sender. */
const DOES_NOT_SERVE: Hex = encodeErrorResult({
  abi: [{ type: 'error', name: 'PolicyManager_ActionDoesNotServeAccount', inputs: [] }],
  errorName: 'PolicyManager_ActionDoesNotServeAccount',
});

describe('RECOVERY_ACTION_IMPLEMENTATION_ABI', () => {
  it('declares the one view AMBIRE_IMPLEMENTATION(), returning an address, under 0xe352b7b9', () => {
    const [view] = RECOVERY_ACTION_IMPLEMENTATION_ABI;

    expect(RECOVERY_ACTION_IMPLEMENTATION_ABI).toHaveLength(1);
    expect(view).toMatchObject({ type: 'function', name: 'AMBIRE_IMPLEMENTATION', stateMutability: 'view', inputs: [] });
    expect(view.outputs.map((output) => output.type)).toEqual(['address']);
    expect(selectorOf('AMBIRE_IMPLEMENTATION()')).toBe('0xe352b7b9');
    expect(IMPLEMENTATION_SELECTOR).toBe('0xe352b7b9');
    expect(encodeFunctionData({ abi: RECOVERY_ACTION_IMPLEMENTATION_ABI })).toBe('0xe352b7b9');
  });

  it('leaves the read itself out of the core entry', () => {
    expect('actionImplementationAt' in entry).toBe(false);
  });
});

describe("the setup client's AMBIRE_IMPLEMENTATION() read", () => {
  it.each(READS)(
    '%s makes exactly one AMBIRE_IMPLEMENTATION() call to the bound action, from the zero address at the pinned block number, for a declared code-less account',
    async (read) => {
      const { client, seen } = build(declaredCodeLess());

      await client[read](DRAFT);

      expect(implementationCalls(seen)).toEqual([{ to: ACTION, data: IMPLEMENTATION_SELECTOR, from: ZERO, block: PIN.number }]);
    },
  );

  it.each(READS)('%s reads the action the client is bound to', async (read) => {
    const { client, seen } = build({ ...declaredCodeLess(), action: OTHER_ACTION });

    await client[read](DRAFT);

    expect(implementationCalls(seen).map((call) => getAddress(call.to))).toEqual([OTHER_ACTION]);
  });

  it.each<[string, BuildOptions]>([
    ['the account holds code and an implementation is declared', { configuration: { accountImplementation: SERVED } }],
    ['the account holds code and nothing is declared', {}],
    ['the account holds no code and nothing is declared', { world: { code: '0x' } }],
  ])('makes no AMBIRE_IMPLEMENTATION() call where %s', async (_name, options) => {
    for (const read of READS) {
      const { client, seen } = build(options);

      await client[read](DRAFT);

      expect(implementationCalls(seen), read).toEqual([]);
    }
  });

  it.each(READS)('%s reads a declared code-less account once, by its code, and never calls it', async (read) => {
    const { client, seen } = build(declaredCodeLess({ simulate: answeringHandler(HANDLER_WORD) }));

    await client[read](DRAFT);

    expect(seen.codes).toEqual([{ address: ACCOUNT, block: PIN.number }]);
    expect(accountCalls(seen)).toEqual([]);
  });

  it.each(READS)('%s rejects with a transport failure of the read as itself', async (read) => {
    const failure = transportFailure();

    await expect(build(declaredCodeLess({ implementation: { rejects: failure } })).client[read](DRAFT)).rejects.toBe(failure);
  });
});

describe('validateSetup of a code-less account declared to get an implementation', () => {
  it('raises no error and one account.deploy-pending where the action serves the declared implementation', async () => {
    const result = await build(declaredCodeLess()).client.validateSetup(DRAFT);
    const deployed = await build().client.validateSetup(DRAFT);

    expect(result.errors).toEqual([]);
    expect(fitFindings(result)).toEqual([
      {
        code: 'account.deploy-pending',
        subject: 'account',
        values: { account: ACCOUNT, accountImplementation: SERVED, servedImplementation: SERVED, actionImplementation: SERVED },
      },
    ]);
    expect(result.warnings.filter((finding) => finding.code !== 'account.deploy-pending')).toEqual(deployed.warnings);
  });

  it("raises action.unsupported where the action answers another implementation than the declared and served one", async () => {
    const result = await build(declaredCodeLess({ implementation: addressWord(OTHER_IMPLEMENTATION) })).client.validateSetup(DRAFT);

    expect(result.errors).toEqual([
      {
        code: 'action.unsupported',
        subject: 'action',
        values: {
          action: ACTION,
          account: ACCOUNT,
          supportsAccount: true,
          accountImplementation: SERVED,
          servedImplementation: SERVED,
          actionImplementation: OTHER_IMPLEMENTATION,
        },
      },
    ]);
    expect(fitFindings(result)).toHaveLength(1);
  });

  it("passes where the declaration is the action's answer though the descriptor names another", async () => {
    const options = declaredCodeLess({ implementation: addressWord(OTHER_IMPLEMENTATION) }, OTHER_IMPLEMENTATION);
    const result = await build(options).client.validateSetup(DRAFT);

    expect(result.errors).toEqual([]);
    expect(fitFindings(result).map((finding) => finding.code)).toEqual(['account.deploy-pending']);
  });

  it.each<[string, Answer<Hex>]>([
    ['a revert', { rejects: revert('0x') }],
    ['no bytes', '0x'],
    ['a word with dirty top bytes', `0x${'ff'.repeat(12)}${OTHER_IMPLEMENTATION.slice(2).toLowerCase()}`],
  ])("reads %s as unanswered and judges against the descriptor's served implementation", async (_name, implementation) => {
    const served = await build(declaredCodeLess({ implementation })).client.validateSetup(DRAFT);
    const other = await build(declaredCodeLess({ implementation }, OTHER_IMPLEMENTATION)).client.validateSetup(DRAFT);

    expect(served.errors).toEqual([]);
    expect(fitFindings(served)).toEqual([
      { code: 'account.deploy-pending', subject: 'account', values: { account: ACCOUNT, accountImplementation: SERVED, servedImplementation: SERVED } },
    ]);
    expect(other.errors.map((finding) => finding.code)).toEqual(['action.unsupported']);
    expect('actionImplementation' in (other.errors[0]?.values ?? {})).toBe(false);
  });

  it('keeps account.not-deployed for a code-less account that declares nothing', async () => {
    const result = await build({ world: { code: '0x' } }).client.validateSetup(DRAFT);

    expect(fitFindings(result).map((finding) => finding.code)).toEqual(['account.not-deployed']);
  });
});

describe('describeSetup of a code-less account declared to get an implementation', () => {
  it.each<[string, Answer<Hex>]>([
    ['the served implementation', addressWord(SERVED)],
    ['another implementation', addressWord(OTHER_IMPLEMENTATION)],
    ['a revert', { rejects: revert('0x') }],
  ])('describes it as an undeclared one where the action answers %s, the fit and every authority left unread', async (_name, implementation) => {
    const declared = build(declaredCodeLess({ implementation }));
    const description = await declared.client.describeSetup(DRAFT);

    expect(description).toEqual(await build({ world: { code: '0x' } }).client.describeSetup(DRAFT));
    expect('supportsAccount' in description.action).toBe(false);
    expect('actionImplementation' in description.action).toBe(false);
    expect('fallbackHandler' in description).toBe(false);
    expect(description.candidateKeys.every((candidate) => !candidate.isAuthority)).toBe(true);
    expect(members(declared.seen)).not.toContain('action.isAuthority');
  });
});

describe('prepareCommitSetup on a code-less account', () => {
  it.each<[string, PrepareOptions | undefined]>([
    ['options.simulate true', { simulate: true }],
    ['the configuration default, which simulates', undefined],
    ['options.simulate false', { simulate: false }],
  ])('returns the atomic arming-then-commit batch with no simulation under %s', async (_name, options) => {
    const { client, seen } = build(declaredCodeLess());
    const prepared = (await client.prepareCommitSetup(EMPTY_DRAFT, undefined, options)) as PreparedBatch;

    expect(prepared.kind).toBe('batch');
    expect(prepared.atomic).toBe(true);
    expect(prepared.block).toEqual(PIN);
    expect(prepared.calls).toHaveLength(2);
    expect(prepared.calls[0]?.data).toBe(ARMING_DATA);
    expect(prepared.calls[0]?.sender).toBe('account');

    const decoded = decodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, data: prepared.calls[1]?.data ?? '0x' });

    expect(decoded.functionName).toBe('commitSetup');
    expect(decoded.args?.[1]).toBe(referenceCommitment(EMPTY_DRAFT, ACCOUNT, ACTION, 1n));

    for (const call of prepared.calls) expect('simulation' in call && call.simulation !== undefined).toBe(false);

    expect(accountCalls(seen)).toEqual([]);
    expect(members(seen)).not.toContain('action.isAuthorized');
    expect(seen.codes).toEqual([{ address: ACCOUNT, block: PIN.number }]);
  });

  it('carries no vacuous arming success and no commit revert where separate calls would report both', async () => {
    const simulate = async (_to: Address, _data: Hex, _from: Address, index: number): Promise<Hex> => (index === 1 ? Promise.reject(revert(DOES_NOT_SERVE)) : '0x');
    const prepared = (await build(declaredCodeLess({ simulate })).client.prepareCommitSetup(EMPTY_DRAFT, undefined, { simulate: true })) as PreparedBatch;

    expect(prepared.calls.map((call) => call.simulation)).toEqual([undefined, undefined]);
  });

  it('resolves though every simulation call would fail at the node, since none is made', async () => {
    const failure = transportFailure();

    await expect(build(declaredCodeLess({ simulate: async () => Promise.reject(failure) })).client.prepareCommitSetup(EMPTY_DRAFT)).resolves.toMatchObject({
      kind: 'batch',
    });
  });

  it('still simulates both calls, from the account, where the account holds code and declares an implementation', async () => {
    const { client, seen } = build({ configuration: { accountImplementation: SERVED } });
    const prepared = (await client.prepareCommitSetup(EMPTY_DRAFT)) as PreparedBatch;

    expect(prepared.calls.map((call) => call.simulation)).toEqual([{ success: true }, { success: true }]);
    expect(seen.calls.filter((call) => call.from.toLowerCase() === ACCOUNT.toLowerCase())).toHaveLength(2);
  });
});

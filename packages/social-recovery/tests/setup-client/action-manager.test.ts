import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { KitRefusalError, SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE, type Address, type Hex } from '../../src/index';
import {
  ACTION,
  DRAFT,
  MANAGER,
  MANAGER_SELECTOR,
  OTHER_ACTION,
  PIN,
  addressWord,
  build,
  members,
  revert,
  transportFailure,
  withBackup,
  type Answer,
  type Seen,
} from './doubles';

const ZERO: Address = '0x0000000000000000000000000000000000000000';
const OTHER_MANAGER: Address = getAddress(`0x${'a9'.repeat(20)}`);

const READS = ['validateSetup', 'describeSetup'] as const;

/** The `MANAGER()` calls the provider double saw, in order. */
const managerCalls = (seen: Seen) => seen.calls.filter((call) => call.data.slice(0, 10).toLowerCase() === MANAGER_SELECTOR);

const MISMATCH = {
  code: 'action.manager-mismatch',
  subject: 'action',
  values: { action: ACTION, manager: MANAGER, actionManager: OTHER_MANAGER },
} as const;

describe("the setup client's MANAGER() read", () => {
  it.each(READS)('%s makes exactly one MANAGER() call to the bound action, from the zero address at the pinned block number', async (read) => {
    const { client, seen } = build();

    await client[read](DRAFT);

    expect(managerCalls(seen)).toEqual([{ to: ACTION, data: MANAGER_SELECTOR, from: ZERO, block: PIN.number }]);
  });

  it.each(READS)('%s reads the action the client is bound to', async (read) => {
    const { client, seen } = build({ action: OTHER_ACTION });

    await client[read](DRAFT);

    expect(managerCalls(seen).map((call) => getAddress(call.to))).toEqual([OTHER_ACTION]);
  });

  it('validateSetup of a client constructed over a mismatched pair returns action.manager-mismatch', async () => {
    const result = await build({ world: { manager: addressWord(OTHER_MANAGER) } }).client.validateSetup(DRAFT);

    expect(result.errors).toEqual([MISMATCH]);
  });

  it('validateSetup of a paired client returns no such error', async () => {
    const result = await build().client.validateSetup(DRAFT);

    expect(result.errors.map((finding) => finding.code)).not.toContain('action.manager-mismatch');
  });

  it.each<[string, Answer<Hex>]>([
    ['a revert', { rejects: revert('0x') }],
    ['no bytes', '0x'],
    ['a word with dirty top bytes', `0x${'ff'.repeat(12)}${OTHER_MANAGER.slice(2).toLowerCase()}`],
  ])('validateSetup reads %s as unanswered and raises nothing for it', async (_name, manager) => {
    const result = await build({ world: { manager } }).client.validateSetup(DRAFT);

    expect(result).toEqual(await build().client.validateSetup(DRAFT));
  });

  it.each(READS)('%s rejects with a transport failure of the MANAGER() read as itself', async (read) => {
    const failure = transportFailure();

    await expect(build({ world: { manager: { rejects: failure } } }).client[read](DRAFT)).rejects.toBe(failure);
  });

  it('describeSetup describes a mismatched pair as it describes the paired one', async () => {
    const mismatched = await build({ world: { manager: addressWord(OTHER_MANAGER) } }).client.describeSetup(DRAFT);
    const paired = await build().client.describeSetup(DRAFT);

    expect(mismatched).toEqual(paired);
  });

  it('prepareCommitSetup over a mismatched pair makes one MANAGER() read and refuses with the findings carrying action.manager-mismatch', async () => {
    const draft = withBackup(DRAFT, 'empty');
    const findings = await build({ world: { manager: addressWord(OTHER_MANAGER) } }).client.validateSetup(draft);
    const { client, seen } = build({ world: { manager: addressWord(OTHER_MANAGER) } });
    const thrown = await client.prepareCommitSetup(draft).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect((thrown as object).constructor).toBe(KitRefusalError);
    expect((thrown as KitRefusalError).message).toBe(SETUP_CLIENT_VALIDATION_REFUSED_MESSAGE);
    expect((thrown as KitRefusalError).findings).toEqual(findings);
    expect((thrown as KitRefusalError).findings?.errors).toEqual([MISMATCH]);
    expect(managerCalls(seen)).toEqual([{ to: ACTION, data: MANAGER_SELECTOR, from: ZERO, block: PIN.number }]);
    expect(members(seen)).not.toContain('manager.prepareCommitSetup');
    expect(members(seen)).not.toContain('action.armingCall');
  });
});

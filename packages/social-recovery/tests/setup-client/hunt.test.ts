import { decodeFunctionData, getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  BACKUP_PADDING_SIZE,
  KitRefusalError,
  POLICY_MANAGER_WRITES_ABI,
  serializeConfiguration,
  SetupClient,
  type Address,
  type Hex,
  type PreparedBatch,
  type PreparedCall,
  type SetupDraft,
} from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  BOUND_FILTER,
  build,
  COMMITTED,
  committed,
  codecFor,
  CONFIGURATION,
  configurationOf,
  defaultRegistry,
  defaultWorld,
  DESCRIPTOR,
  doubles,
  DRAFT,
  HEADER,
  METHOD_A,
  METHOD_B,
  position,
  referenceCommitment,
  standingState,
  transportFailure,
  withBackup,
} from './doubles';

/** A draft whose serialized configuration is wider than the backup padding. */
const WIDE_DRAFT: SetupDraft = {
  ...DRAFT,
  clauses: [
    {
      threshold: 1,
      credentials: Array.from({ length: 4 }, (_, index) => ({
        method: index % 2 === 0 ? METHOD_A : METHOD_B,
        config: `0x${index.toString(16).padStart(2, '0').repeat(BACKUP_PADDING_SIZE / 4)}` as Hex,
      })),
    },
  ],
};

const commitArguments = (seen: ReturnType<typeof build>['seen']): readonly unknown[] =>
  seen.parts.find((part) => part.member === 'prepareCommitSetup')?.args ?? [];

const CODEC = codecFor(ACTION);

describe('inputs that slip past a naive setup client', () => {
  it('refuses an encrypted backup wider than the padding with a KitRefusalError carrying backup.too-wide, before any provider call', async () => {
    const { client, seen } = build();
    const thrown = await client.prepareCommitSetup(WIDE_DRAFT, 'pw').then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(thrown).toBeInstanceOf(KitRefusalError);
    expect((thrown as object).constructor).toBe(KitRefusalError);
    expect(Object.hasOwn(thrown as object, 'cause')).toBe(false);
    expect((thrown as KitRefusalError).findings?.errors.map((error) => error.code)).toContain('backup.too-wide');
    expect(seen.provider).toEqual([]);
    expect(seen.parts).toEqual([]);
  });

  it('commits a clear backup wider than the padding unpadded and unrefused', async () => {
    const { client, seen } = build();
    const draft = withBackup(WIDE_DRAFT, 'clear');

    await client.prepareCommitSetup(draft);

    const bytes = commitArguments(seen)[4] as Hex;

    expect(bytes).toBe(serializeConfiguration(configurationOf(draft)));
    expect((bytes.length - 2) / 2).toBeGreaterThan(BACKUP_PADDING_SIZE);
  });

  it('refuses a draft method spelled in mixed case with a bad checksum before any provider call', async () => {
    const good = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefab01');
    const bad = `0x${good.slice(2, 3) === good.slice(2, 3).toUpperCase() ? good.slice(2, 3).toLowerCase() : good.slice(2, 3).toUpperCase()}${good.slice(3)}` as Address;
    const draft: SetupDraft = { ...DRAFT, clauses: [{ threshold: 1, credentials: [{ method: bad, config: '0x01' }] }] };
    const { client, seen } = build();

    expect(bad).not.toBe(good);
    await expect(client.prepareCommitSetup(withBackup(draft, 'empty'))).rejects.toThrow(TypeError);
    expect(seen.provider).toEqual([]);
  });

  it('commits a lower-case method spelling to the same commitment as its checksummed spelling', async () => {
    const lower: SetupDraft = {
      ...withBackup(DRAFT, 'empty'),
      clauses: [{ threshold: 1, credentials: [{ method: METHOD_A.toLowerCase() as Address, config: '0xABCDEF' }] }],
    };
    const { client, seen } = build({ world: { authorized: true, state: standingState(COMMITTED, 1n, 10) } });

    await client.prepareCommitSetup(lower, undefined, { simulate: false });

    const reference = referenceCommitment(
      { ...lower, clauses: [{ threshold: 1, credentials: [{ method: METHOD_A, config: '0xabcdef' }] }] },
      ACCOUNT,
      ACTION,
      2n,
    );

    expect(commitArguments(seen)[1]).toBe(reference);
  });

  it.each([
    ['an unknown backup choice', { ...DRAFT, privacy: { publicMetadata: '0x', backup: 'paper' } }],
    ['no privacy at all', { wait: DRAFT.wait, ignoresPause: false, clauses: DRAFT.clauses }],
  ])('refuses a draft with %s before any provider call', async (_name, draft) => {
    const { client, seen } = build();

    await expect(client.prepareCommitSetup(draft as unknown as SetupDraft)).rejects.toThrow(TypeError);
    expect(seen.provider).toEqual([]);
  });

  it('passes a failed code read through as itself', async () => {
    const failure = transportFailure();
    const { client } = build({ world: { code: { rejects: failure } } });

    await expect(client.prepareCommitSetup(withBackup(DRAFT, 'empty'))).rejects.toBe(failure);
  });

  it('propagates a revert of isAuthorized on an account that has code', async () => {
    const reverted = { data: '0x' as Hex };
    const { client } = build({ world: { authorized: { rejects: reverted } } });

    await expect(client.prepareClearSetup()).rejects.toBe(reverted);
  });

  it('does not count a removed event as landed', async () => {
    const prepared = (await build().client.prepareCommitSetup(withBackup(DRAFT, 'empty'))) as PreparedBatch;
    const commitment = referenceCommitment(DRAFT, ACCOUNT, ACTION, 1n);
    const { client } = build({ world: { bound: [committed(1n, commitment, '0x', position(HEADER.number, 0, true))] } });

    expect((await client.confirmSetup(withBackup(DRAFT, 'empty'), prepared)).landed).toBe(false);
  });

  it('refuses a commit prepared for another account or nonce, recomputed under this draft', async () => {
    const prepared = (await build().client.prepareCommitSetup(withBackup(DRAFT, 'empty'))) as PreparedBatch;
    const commit = prepared.calls[1] as PreparedCall;
    const decoded = decodeFunctionData({ abi: POLICY_MANAGER_WRITES_ABI, data: commit.data });

    expect(decoded.args?.[2]).toBe(1n);

    const { client } = build({ account: getAddress('0x00000000000000000000000000000000000acc02') });

    await expect(client.confirmSetup(withBackup(DRAFT, 'empty'), prepared)).rejects.toThrow();
  });

  it('confirms against the backup choice it was handed, the backup being outside the commitment', async () => {
    const prepared = (await build().client.prepareCommitSetup(DRAFT, 'pw')) as PreparedBatch;
    const commitment = referenceCommitment(DRAFT, ACCOUNT, ACTION, 1n);
    const { client } = build({ world: { bound: [committed(1n, commitment, '0x', position(HEADER.number))] } });

    expect((await client.confirmSetup(withBackup(DRAFT, 'clear'), prepared)).landed).toBe(true);
  });

  it('infers the removed key from the bound log with the required codec, naming no-source on an empty history', async () => {
    const made = doubles(defaultWorld());
    const client = new SetupClient(
      made.provider,
      DESCRIPTOR,
      ACCOUNT,
      ACTION,
      CONFIGURATION,
      made.manager,
      made.action,
      made.events,
      defaultRegistry(),
      CODEC,
    );
    const description = await client.describeSetup(DRAFT);

    expect(description.removedKey).toBe('no-source');
    expect(made.seen.fetches).toEqual([{ filter: BOUND_FILTER, range: { from: DESCRIPTOR.deployedAt, to: HEADER.number } }]);
  });
});

import { describe, expect, it } from 'vitest';
import { ATTEMPT_STATES, type ActionState } from '../../src/index';
import { attemptIn, build, COMMITTED, HEADER, members, noSetupState, PIN, standingState } from './doubles';

describe('setupState', () => {
  it('reads stateOf and isAuthorized at one block and carries the full header', async () => {
    const { client, seen } = build({ world: { state: standingState(COMMITTED, 4n, 900), authorized: true } });
    const state = await client.setupState();

    expect(state).toEqual({
      isAuthorized: true,
      hasSetup: true,
      setupCommitment: COMMITTED,
      setupNonce: 4n,
      setupCommittedAtBlock: 900,
      attemptActive: false,
      block: HEADER,
    });
    expect(seen.blockTags).toEqual(['latest']);
    expect(members(seen).sort()).toEqual(['action.isAuthorized', 'manager.stateOf']);

    for (const call of seen.parts) {
      expect(call.args[call.args.length - 1]).toEqual(PIN);
    }
  });

  it('reports no setup over the zero commitment', async () => {
    const { client } = build({ world: { state: noSetupState(3n, 700) } });
    const state = await client.setupState();

    expect(state.hasSetup).toBe(false);
    expect(state.setupNonce).toBe(3n);
    expect(state.setupCommittedAtBlock).toBe(700);
  });

  it.each(ATTEMPT_STATES)('reports attemptActive only for a waiting attempt (%s)', async (attemptState) => {
    const state: ActionState = { ...standingState(COMMITTED, 1n, 10), attempt: attemptIn(attemptState) };
    const { client } = build({ world: { state } });

    expect((await client.setupState()).attemptActive).toBe(attemptState === 'Waiting');
  });

  it('lower-cases the header hash and the commitment', async () => {
    const upperHash = `0x${'AB'.repeat(32)}` as const;
    const upperCommitment = `0x${'C7'.repeat(32)}` as const;
    const { client, seen } = build({
      world: { header: { ...HEADER, hash: upperHash }, state: standingState(upperCommitment, 1n, 10) },
    });
    const state = await client.setupState();

    expect(state.block.hash).toBe(upperHash.toLowerCase());
    expect(state.setupCommitment).toBe(upperCommitment.toLowerCase());
    expect(seen.parts[0]?.args[0]).toEqual({ number: HEADER.number, hash: upperHash.toLowerCase() });
  });

  it('refuses a malformed header before any part call', async () => {
    const { client, seen } = build({ world: { header: { number: 1, timestamp: 2, hash: '0x1234' } } });

    await expect(client.setupState()).rejects.toThrow(TypeError);
    expect(seen.parts).toEqual([]);
  });

  it('reads a code-less account as unauthorized without calling isAuthorized', async () => {
    const { client, seen } = build({ world: { code: '0x', authorized: { rejects: { data: '0x' } } } });

    expect((await client.setupState()).isAuthorized).toBe(false);
    expect(members(seen)).not.toContain('action.isAuthorized');
  });

  it('rejects with a block read failure as itself', async () => {
    const failure = new Error('unreachable');
    const { client } = build({ world: { header: { rejects: failure } } });

    await expect(client.setupState()).rejects.toBe(failure);
  });

  it('rejects with a revert of isAuthorized on an account with code', async () => {
    const reverted = { data: '0x' as const };
    const { client } = build({ world: { authorized: { rejects: reverted } } });

    await expect(client.setupState()).rejects.toBe(reverted);
  });
});

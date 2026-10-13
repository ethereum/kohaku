import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, expectTypeOf, it } from 'vitest';
import * as source from '../../src/index';
import type { IRecoveryClient, RecoveryClient } from '../../src/index';
import { PACKAGE_ROOT } from '../helpers/source';
import { rig } from './doubles';

const loadBuilt = async (): Promise<Record<string, unknown>> =>
  (await import(pathToFileURL(join(PACKAGE_ROOT, 'dist', 'index.js')).href)) as Record<string, unknown>;

/** The members over the gathering record, the prepares and the state record. */
const MEMBERS = [
  'getApproverRequests',
  'addApproverReply',
  'assess',
  'complete',
  'prepareStartAttempt',
  'prepareCancelByProofs',
  'prepareCancelByOwner',
  'prepareCancelByVeto',
  'prepareExecuteHandover',
  'recoveryState',
];

describe('the recovery client surface', () => {
  it('the source entry exports RecoveryClient as a class', () => {
    expect(typeof source.RecoveryClient).toBe('function');
  });

  it('the built entry exports RecoveryClient as a class', async () => {
    expect(typeof (await loadBuilt())['RecoveryClient']).toBe('function');
  });

  it('the built declarations declare the class with the two inits', () => {
    const declarations = readFileSync(join(PACKAGE_ROOT, 'dist', 'index.d.ts'), 'utf8');

    expect(declarations).toMatch(/class RecoveryClient\b/);
    expect(declarations).toMatch(/initRecoveryGathering\(/);
    expect(declarations).toMatch(/initCancelGathering\(/);
  });

  it('carries the two inits and the injected event manager', () => {
    const { client, events } = rig();

    expect(typeof client.initRecoveryGathering).toBe('function');
    expect(typeof client.initCancelGathering).toBe('function');
    expect(client.events).toBe(events);
  });

  it.each(MEMBERS)('carries %s as a method', (member) => {
    const { client } = rig();

    expect(typeof (client as unknown as Record<string, unknown>)[member]).toBe('function');
  });

  it('satisfies the frozen client interface', () => {
    expectTypeOf<RecoveryClient>().toMatchTypeOf<IRecoveryClient>();

    const assigned: IRecoveryClient = rig().client;

    expect(assigned).toBeDefined();
  });

  it('the constructor reads nothing', () => {
    const { seen } = rig();

    expect(seen).toEqual([]);
  });
});

/** Names this client once exported and no longer does: the merged constants carry their values. */
const REMOVED = ['RECOVERY_CLIENT_KEY_VALUE', 'RECOVERY_CLIENT_REVOKED_VALUE', 'RECOVERY_CLIENT_VERSION_ESCAPED_MESSAGE'];

describe('the constants the client shares with the merged modules', () => {
  it.each(REMOVED)('the source entry no longer exports %s', (name) => {
    expect(Object.hasOwn(source, name)).toBe(false);
  });

  it.each(REMOVED)('the built entry no longer exports %s', async (name) => {
    expect(Object.hasOwn(await loadBuilt(), name)).toBe(false);
  });

  it('the merged words and the escape message stay exported', () => {
    expect(source.POLICY_MANAGER_TRUE_WORD).toBe(`0x${'00'.repeat(31)}01`);
    expect(source.RECOVERY_ACTION_DISARMED_VALUE).toBe(`0x${'00'.repeat(32)}`);
    expect(typeof source.SETUP_CLIENT_VERSION_ESCAPED_MESSAGE).toBe('string');
  });
});

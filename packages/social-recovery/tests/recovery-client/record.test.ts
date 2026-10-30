import { describe, expect, it } from 'vitest';
import { GATHERING_VERSION, seed, type Configuration, type Gathering, type GatheringMembers } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  attemptIn,
  CONFIGURATION,
  DESCRIPTOR,
  ecdsaConfig,
  GUARDIAN_A,
  GUARDIAN_B,
  HANDOVER,
  HEADER,
  MANAGER,
  METHOD_ECDSA,
  METHOD_OTHER,
  METHOD_PASSKEY,
  ORDER,
  partiesWith,
  PAUSER,
  referenceBody,
  referenceEncodeBody,
  referenceSalt,
  rig,
  SETUP_NONCE,
  stateFor,
  world,
  ZERO,
} from './doubles';

const WINDOW = 3_600;
const BODY = referenceEncodeBody(referenceBody(CONFIGURATION, ACCOUNT));

const open = async (overrides = world()): Promise<Gathering> =>
  rig(overrides).client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: WINDOW });

const cancel = async (consumableAfter = 1_760_050_000): Promise<Gathering> =>
  rig(world({ state: stateFor(CONFIGURATION, attemptIn('Waiting', 4n, consumableAfter)) })).client.initCancelGathering(CONFIGURATION, {
    window: WINDOW,
  });

const membersOf = (record: Gathering): GatheringMembers => ({ purpose: record.purpose, request: record.request }) as GatheringMembers;

describe('the opening record', () => {
  it('is a gathering of this build, purpose approval, no replies', async () => {
    const record = await open();

    expect(record.kind).toBe('gathering');
    expect(record.version).toBe(GATHERING_VERSION);
    expect(record.purpose).toBe('approval');
    expect(record.replies).toEqual([]);
  });

  it('carries the descriptor domain, the pair, the next attempt id, the nonce and the body', async () => {
    const { request } = await open();

    expect(request.chainId).toBe(String(DESCRIPTOR.chainId));
    expect(request.manager).toBe(MANAGER);
    expect(request.digestVersion).toBe(DESCRIPTOR.digestVersion);
    expect(request.account).toBe(ACCOUNT);
    expect(request.action).toBe(ACTION);
    expect(request.attemptId).toBe('5');
    expect(request.setupNonce).toBe(String(SETUP_NONCE));
    expect(request.setupBody.toLowerCase()).toBe(BODY.toLowerCase());
  });

  it('sets validUntil to the pinned timestamp plus the window, chain time only', async () => {
    const { request } = await open();

    expect(request.validUntil).toBe(String(HEADER.timestamp + WINDOW));
  });

  it('encodes the handover through the codec into the payload', async () => {
    const built = rig();
    const record = await built.client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: WINDOW });

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(record.request.payload).toBe(built.codec.encode(HANDOVER));
    expect(built.codec.decode(record.request.payload)).toEqual(HANDOVER);
  });

  it('stores the order as given, its amount a decimal string', async () => {
    const record = await open();

    if (record.purpose !== 'approval') throw new Error('approval expected');

    expect(record.request.order).toEqual({ token: ORDER.token, amount: '1234567890123456789', payee: ORDER.payee });
  });

  it('a window below the request floor still builds: the short window stays a gathering finding', async () => {
    const record = await rig().client.initRecoveryGathering(CONFIGURATION, HANDOVER, ORDER, { window: 60 });

    expect(record.request.validUntil).toBe(String(HEADER.timestamp + 60));
  });

  it('passes seed unchanged', async () => {
    const record = await open();

    expect(seed(membersOf(record), record.places)).toEqual(record);
  });
});

describe('the place map', () => {
  it('lists every place in body order with default salts where none was given and labels kept', async () => {
    const { places } = await open();
    const flat = CONFIGURATION.clauses.flatMap((clause) => clause.credentials);

    expect(places.map((entry) => entry.place)).toEqual([0, 1, 2, 3, 4]);
    expect(places.map((entry) => entry.method)).toEqual(flat.map((credential) => credential.method));
    expect(places.map((entry) => entry.config.toLowerCase())).toEqual(flat.map((credential) => credential.config.toLowerCase()));
    expect(places.map((entry) => entry.salt.toLowerCase())).toEqual([
      referenceSalt(ACCOUNT, 0),
      `0x${'aa'.repeat(32)}`,
      referenceSalt(ACCOUNT, 2),
      referenceSalt(ACCOUNT, 3),
      referenceSalt(ACCOUNT, 4),
    ]);
    expect(places.map((entry) => entry.label)).toEqual(['alice', 'laptop', undefined, undefined, undefined]);
  });

  it('marks a method stopped only where paused answered true, and keeps its places', async () => {
    const { places } = await open(world({ paused: new Map([[METHOD_ECDSA.toLowerCase(), { answered: true, value: true }]]) }));

    expect(places.map((entry) => entry.standing)).toEqual(['stopped', 'not-stopped', 'stopped', 'stopped', 'not-stopped']);
  });

  it('marks a method stoppable only where its pause holder is nonzero', async () => {
    const parties = new Map([
      [METHOD_PASSKEY.toLowerCase(), { answered: true as const, value: partiesWith(PAUSER) }],
      [METHOD_OTHER.toLowerCase(), { answered: true as const, value: partiesWith(ZERO) }],
    ]);
    const { places } = await open(world({ parties }));

    expect(places.map((entry) => entry.stoppable)).toEqual([false, true, false, false, false]);
  });

  it('a stopped method without a pause holder is still stopped', async () => {
    const { places } = await open(world({ paused: new Map([[METHOD_OTHER.toLowerCase(), { answered: true, value: true }]]) }));

    expect(places[4]).toMatchObject({ standing: 'stopped', stoppable: false });
  });

  it('flags code only on wallet guardians whose address holds code at the pinned block', async () => {
    const { places } = await open(world({ code: new Map([[GUARDIAN_B.toLowerCase(), '0x6080']]) }));

    expect(places.map((entry) => entry.credentialHoldsCode)).toEqual([false, false, true, false, false]);
  });

  it('a guardian address holding code flags every place it sits at', async () => {
    const { places } = await open(world({ code: new Map([[GUARDIAN_A.toLowerCase(), '0x00']]) }));

    expect(places.map((entry) => entry.credentialHoldsCode)).toEqual([true, false, false, true, false]);
  });
});

describe('the cancel record', () => {
  it('carries the live attempt id, the nonce, the body and the copied consumableAfter', async () => {
    const record = await cancel(1_760_050_123);

    expect(record.purpose).toBe('cancellation');
    expect(record.request.attemptId).toBe('4');
    expect(record.request.setupNonce).toBe(String(SETUP_NONCE));
    expect(record.request.setupBody.toLowerCase()).toBe(BODY.toLowerCase());
    expect(record.request.validUntil).toBe(String(HEADER.timestamp + WINDOW));

    if (record.purpose !== 'cancellation') throw new Error('cancellation expected');

    expect(record.request.consumableAfter).toBe('1760050123');
    expect('payload' in record.request).toBe(false);
  });

  it('passes seed unchanged', async () => {
    const record = await cancel();

    expect(seed(membersOf(record), record.places)).toEqual(record);
  });

  it('a window exactly at the cancel bound builds', async () => {
    const record = await rig(world({ state: stateFor(CONFIGURATION, attemptIn('Waiting')) })).client.initCancelGathering(CONFIGURATION, {
      window: 7_200,
    });

    expect(record.request.validUntil).toBe(String(HEADER.timestamp + 7_200));
  });
});

describe('readings a naive init would misread', () => {
  it('a wallet method spelled all lower case is still a wallet guardian place', async () => {
    const lowered = {
      ...CONFIGURATION,
      clauses: CONFIGURATION.clauses.map((clause) => ({
        ...clause,
        credentials: clause.credentials.map((credential) => ({ ...credential, method: credential.method.toLowerCase() as `0x${string}` })),
      })),
    };
    const built = rig(world({ state: stateFor(lowered), code: new Map([[GUARDIAN_B.toLowerCase(), '0x6080']]) }));
    const record = await built.client.initRecoveryGathering(lowered, HANDOVER, ORDER, { window: WINDOW });

    expect(record.places.map((entry) => entry.credentialHoldsCode)).toEqual([false, false, true, false, false]);
  });

  it.each([1, 'true', null, undefined])('paused answering %j rather than a boolean rejects the init', async (value) => {
    const paused = new Map([[METHOD_OTHER.toLowerCase(), { answered: true as const, value: value as unknown as boolean }]]);

    await expect(open(world({ paused }))).rejects.toBeInstanceOf(TypeError);
  });

  it('the cancel init records the setup nonce stateOf reads, not the attempt own', async () => {
    const state = { ...stateFor(CONFIGURATION, { ...attemptIn('Waiting'), setupNonce: SETUP_NONCE - 1n }) };
    const record = await rig(world({ state })).client.initCancelGathering(CONFIGURATION, { window: WINDOW });

    expect(record.request.setupNonce).toBe(String(SETUP_NONCE));
  });
});

describe('the places carry lower-cased hex', () => {
  const upper = (hex: string): `0x${string}` => `0x${hex.slice(2).toUpperCase()}`;
  const SHOUTED: Configuration = {
    clauses: [
      {
        threshold: 1,
        credentials: [
          { method: METHOD_ECDSA, config: upper(ecdsaConfig(GUARDIAN_A)) },
          { method: METHOD_PASSKEY, config: '0xABCDEF', salt: upper(`0x${'ab'.repeat(32)}`) },
        ],
      },
    ],
    wait: 60,
    ignoresPause: false,
  };

  it.each(['opening', 'cancel'] as const)('the %s init returns config and salt exactly lower-case for upper-case input, leaving the source as given', async (init) => {
    const before = structuredClone(SHOUTED);
    const built = rig(world({ state: stateFor(SHOUTED, init === 'cancel' ? attemptIn('Waiting') : attemptIn('None')) }));
    const record =
      init === 'opening'
        ? await built.client.initRecoveryGathering(SHOUTED, HANDOVER, ORDER, { window: WINDOW })
        : await built.client.initCancelGathering(SHOUTED, { window: WINDOW });

    expect(record.places.map((entry) => entry.config)).toEqual([ecdsaConfig(GUARDIAN_A).toLowerCase(), '0xabcdef']);
    expect(record.places.map((entry) => entry.salt)).toEqual([referenceSalt(ACCOUNT, 0).toLowerCase(), `0x${'ab'.repeat(32)}`]);
    expect(SHOUTED).toEqual(before);
  });
});

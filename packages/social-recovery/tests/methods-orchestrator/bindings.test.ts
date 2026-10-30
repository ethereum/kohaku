import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_BINDINGS, KitRefusalError, passkeyMethod, walletMethod, type DeviceBinding, type IRecoveryMethod } from '../../src/index';
import { anonAadhaarMethod, zkPassportMethod } from '../../src/recovery-methods/index';
import { approval, orchestratorOver, recordingMethod, REQUEST_METHOD, thrownBy } from './doubles';

const DEVICE_UNAVAILABLE = { kind: 'reply-failure', cause: 'device-unavailable' } as const;

const peer = vi.hoisted(() => ({
  init: vi.fn((): Promise<void> => Promise.resolve()),
  generateArgs: vi.fn((): Promise<unknown> => Promise.resolve({})),
  prove: vi.fn((): Promise<unknown> => Promise.resolve({})),
  verify: vi.fn((): Promise<boolean> => Promise.resolve(true)),
}));

/** The Aadhaar peer, stubbed so the default bucket never reaches the network. */
vi.mock('@anon-aadhaar/core', () => ({
  ...peer,
  ArtifactsOrigin: { server: 0, local: 1, chunked: 2 },
  productionPublicKeyHash: '18063425702624337643644061197836918910810808173893535653269228433734128853484',
  testPublicKeyHash: '15134874015316324267425466444584014077184337590635665158241104437045239495873',
}));

const without = (binding: DeviceBinding): DeviceBinding[] => DEVICE_BINDINGS.filter((other) => other !== binding);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DEVICE_BOUND = DEVICE_BINDINGS.filter((binding) => binding !== 'none');

describe('a method whose device binding this runtime cannot meet', () => {
  for (const binding of DEVICE_BOUND) {
    it(`${binding}: signingInput and enrollInput throw KitRefusalError before the method is asked`, () => {
      const { method, calls } = recordingMethod(binding);
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]], without(binding));

      expect(thrownBy(() => orchestrator.signingInput(approval()))).toBeInstanceOf(KitRefusalError);
      expect(thrownBy(() => orchestrator.signingInput(approval(), { relyingPartyId: 'example.org' }))).toBeInstanceOf(KitRefusalError);
      expect(thrownBy(() => orchestrator.enrollInput(REQUEST_METHOD, {}))).toBeInstanceOf(KitRefusalError);
      expect(calls).toHaveLength(0);
    });

    it(`${binding}: replyFrom and configFrom answer device-unavailable before the method is asked`, async () => {
      const { method, calls } = recordingMethod(binding);
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]], without(binding));

      expect(await orchestrator.replyFrom(approval(), {}, undefined)).toStrictEqual(DEVICE_UNAVAILABLE);
      expect(await orchestrator.configFrom(REQUEST_METHOD, { kind: 'ceremony' }, undefined)).toStrictEqual(DEVICE_UNAVAILABLE);
      expect(calls).toHaveLength(0);
    });

  }

  for (const binding of DEVICE_BINDINGS) {
    it(`${binding}: met by a runtime naming it, each member calls the method once`, async () => {
      const { method, calls } = recordingMethod(binding);
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]], [binding]);

      orchestrator.signingInput(approval());
      orchestrator.enrollInput(REQUEST_METHOD, {});
      await orchestrator.replyFrom(approval(), {}, undefined);
      await orchestrator.configFrom(REQUEST_METHOD, { kind: 'ceremony' }, undefined);

      expect(calls.map((call) => call.member)).toStrictEqual(['signingInput', 'enrollInput', 'replyFrom', 'configFrom']);
    });
  }

  it('verify and describeRequest answer whatever the binding, since no device is asked', async () => {
    const { method, calls } = recordingMethod('browser-authenticator');
    const orchestrator = orchestratorOver([[REQUEST_METHOD, method]], ['none']);
    const request = approval();

    expect(await orchestrator.verify(request, request.place, '0x01')).toBe('satisfied');
    expect(orchestrator.describeRequest(request).device).toMatchObject({ kind: 'typed-data-wallet' });
    expect(calls.map((call) => call.member)).toStrictEqual(['verify', 'describe']);
  });

  it('an empty list: only a method asking for no device is served', async () => {
    for (const binding of DEVICE_BINDINGS) {
      const { method, calls } = recordingMethod(binding);
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]], []);
      const error = thrownBy(() => orchestrator.signingInput(approval()));
      const reply = await orchestrator.replyFrom(approval(), {}, undefined);

      if (binding === 'none') {
        expect(error).toBeUndefined();
        expect(reply).toMatchObject({ kind: 'recovery-proof-reply' });
        expect(calls).toHaveLength(2);
      } else {
        expect(error).toBeInstanceOf(KitRefusalError);
        expect(reply).toStrictEqual(DEVICE_UNAVAILABLE);
        expect(calls).toHaveLength(0);
      }
    }
  });

  it('none is met by a runtime that names no binding at all', () => {
    const { method, calls } = recordingMethod('none');

    orchestratorOver([[REQUEST_METHOD, method]], []).signingInput(approval());

    expect(calls).toHaveLength(1);
  });

  it('the runtime is what the constructor names: an authenticator API present in the global scope does not count', () => {
    vi.stubGlobal('navigator', { credentials: { get: () => undefined, create: () => undefined } });
    vi.stubGlobal('WebAssembly', globalThis.WebAssembly);

    const { method, calls } = recordingMethod('browser-authenticator');

    expect(thrownBy(() => orchestratorOver([[REQUEST_METHOD, method]], ['none']).signingInput(approval()))).toBeInstanceOf(KitRefusalError);
    expect(calls).toHaveLength(0);
  });
});

describe('the shipped methods against a runtime lacking their binding', () => {
  const shipped: readonly [string, () => IRecoveryMethod][] = [
    ['wallet', () => walletMethod()],
    ['passkey', () => passkeyMethod()],
    ['zkPassport', () => zkPassportMethod()],
    ['Aadhaar', () => anonAadhaarMethod()],
  ];

  for (const [name, make] of shipped) {
    it(`${name}: refused before its own signingInput, replyFrom, enrollInput or configFrom runs`, async () => {
      const method = make();
      const spies = (['signingInput', 'replyFrom', 'enrollInput', 'configFrom'] as const).map((member) => vi.spyOn(method, member));
      const lacking = without(method.deviceBinding);
      const orchestrator = orchestratorOver([[REQUEST_METHOD, method]], lacking);

      if (method.deviceBinding === 'none') {
        expect(lacking).not.toContain('none');

        return;
      }

      expect(thrownBy(() => orchestrator.signingInput(approval()))).toBeInstanceOf(KitRefusalError);
      expect(thrownBy(() => orchestrator.enrollInput(REQUEST_METHOD, {}))).toBeInstanceOf(KitRefusalError);
      expect(await orchestrator.replyFrom(approval(), {}, undefined)).toStrictEqual(DEVICE_UNAVAILABLE);
      expect(await orchestrator.configFrom(REQUEST_METHOD, { kind: 'ceremony' }, undefined)).toStrictEqual(DEVICE_UNAVAILABLE);

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();

      expect(peer.init).not.toHaveBeenCalled();
    });
  }

  it('the wallet is served by a runtime naming none alone', async () => {
    const orchestrator = orchestratorOver([[REQUEST_METHOD, walletMethod()]], ['none']);
    const input = orchestrator.signingInput(approval());

    expect(input).toMatchObject({ primaryType: 'Approval' });
  });

  it('a passkey met by its runtime reaches its own params check, which throws a malformed-argument error', () => {
    const orchestrator = orchestratorOver([[REQUEST_METHOD, passkeyMethod()]], ['browser-authenticator']);
    const error = thrownBy(() => orchestrator.signingInput(approval()));

    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(KitRefusalError);
  });
});

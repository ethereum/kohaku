import { describe, expect, it } from 'vitest';
import * as core from '../../src';
import * as folder from '../../src/method-passkey';
import * as recoveryMethods from '../../src/recovery-methods';
import { DEVICE_BINDINGS, DEVICE_KINDS, type DeploymentDescriptor } from '../../src/interfaces';
import { readVector } from '../kat/read-vector';
import { CONFIG_FILE, configOfKey, ctxFor, freshKey, hexOf, PROOF_FILE, sha256 } from './fixtures';

const method = core.passkeyMethod();

const TEN = [
  'codec',
  'configFrom',
  'describe',
  'deviceBinding',
  'enrollInput',
  'modules',
  'replyFrom',
  'signingInput',
  'vector',
  'verify',
];

const membersOf = (value: object): string[] => {
  const names = new Set<string>(Object.keys(value));
  let proto: unknown = Object.getPrototypeOf(value);

  while (proto !== null && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) if (name !== 'constructor') names.add(name);

    proto = Object.getPrototypeOf(proto);
  }

  return [...names].sort();
};

const descriptor = (methodPasskey: `0x${string}`): DeploymentDescriptor => ({
  chainId: 11155111,
  manager: '0x1111111111111111111111111111111111111111',
  methodEcdsa: '0x2222222222222222222222222222222222222222',
  methodPasskey,
  methodAadhaar: '0x3333333333333333333333333333333333333333',
  methodZkpassport: '0x4444444444444444444444444444444444444444',
  action: '0x5555555555555555555555555555555555555555',
  servedImplementation: '0x6666666666666666666666666666666666666666',
  deployedAt: 1,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [],
  auditedActions: [],
});

describe('the entry', () => {
  it('the folder exports the one factory and nothing else', () => {
    expect(Object.keys(folder)).toEqual(['passkeyMethod']);
  });

  it('the core entry carries it; the recovery-methods entry does not', () => {
    expect(typeof core.passkeyMethod).toBe('function');
    expect(Object.keys(recoveryMethods)).not.toContain('passkeyMethod');
  });
});

describe('the ten members', () => {
  it('carries exactly the ten members and nothing else', () => {
    expect(membersOf(method)).toEqual(TEN);
  });

  it('modules(descriptor) is the descriptor\'s methodPasskey alone', () => {
    const address = '0x7777777777777777777777777777777777777777';

    expect(method.modules(descriptor(address))).toEqual([address]);
    expect(method.modules(descriptor('0x8888888888888888888888888888888888888888'))).toEqual([
      '0x8888888888888888888888888888888888888888',
    ]);
  });

  it('deviceBinding is the browser authenticator', () => {
    expect(method.deviceBinding).toBe('browser-authenticator');
    expect(DEVICE_BINDINGS).toContain(method.deviceBinding);
  });

  it('describe states the WebAuthn device kind and the rp hash the config holds', () => {
    const config = configOfKey(freshKey(), 'wallet.example');
    const facts = method.describe(ctxFor(config));

    expect(facts.kind).toBe('webauthn-authenticator');
    expect(DEVICE_KINDS).toContain(facts.kind);
    expect(Object.values(facts)).toContain(hexOf(sha256('wallet.example')));
  });

  it('describe names no relying-party id text and passes no judgment', () => {
    const facts = method.describe(ctxFor(configOfKey(freshKey(), 'wallet.example')));

    expect(JSON.stringify(facts)).not.toContain('wallet.example');
    expect(Object.values(facts).every((value) => typeof value === 'string')).toBe(true);
  });

  it('describe still states the device kind where the config does not decode, without throwing', () => {
    expect(method.describe(ctxFor('0x1234')).kind).toBe('webauthn-authenticator');
  });

  it('vector names the two files', () => {
    expect([...method.vector].sort()).toEqual([CONFIG_FILE, PROOF_FILE].sort());
  });

  it('both named files exist as blessed vector copies', () => {
    for (const file of method.vector) expect(readVector(file)).toBeDefined();
  });

  it('codec carries the four functions of IMethodCodec', () => {
    expect(Object.keys(method.codec).sort()).toEqual(['decodeConfig', 'decodeProof', 'encodeConfig', 'encodeProof']);
  });
});

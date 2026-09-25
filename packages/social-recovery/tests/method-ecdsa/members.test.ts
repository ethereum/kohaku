import { describe, expect, expectTypeOf, it } from 'vitest';
import * as core from '../../src/index';
import { walletMethod, type Address, type DeploymentDescriptor, type IRecoveryMethod } from '../../src/index';
import { addressWord, ctxFor, SIGNER_ONE } from './fixtures';

const TEN_MEMBERS = [
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

const descriptor = (methodEcdsa: Address): DeploymentDescriptor => ({
  chainId: 11155111,
  manager: '0x0000000000000000000000000000000000000001',
  methodEcdsa,
  methodPasskey: '0x0000000000000000000000000000000000000003',
  methodAadhaar: '0x0000000000000000000000000000000000000004',
  methodZkpassport: '0x0000000000000000000000000000000000000005',
  action: '0x0000000000000000000000000000000000000006',
  servedImplementation: '0x0000000000000000000000000000000000000007',
  deployedAt: 1,
  digestVersion: '1',
  managerVersion: '1.0.0',
  shippedMethods: [methodEcdsa, '0x0000000000000000000000000000000000000003'],
  auditedActions: ['0x0000000000000000000000000000000000000006'],
});

const membersOf = (value: object): string[] => {
  const names = new Set<string>(Object.keys(value));
  let proto: unknown = Object.getPrototypeOf(value);

  while (proto !== null && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) if (name !== 'constructor') names.add(name);

    proto = Object.getPrototypeOf(proto);
  }

  return [...names].sort();
};

describe('the factory', () => {
  it('the core entry exports walletMethod and it returns an IRecoveryMethod', () => {
    expect(typeof core.walletMethod).toBe('function');
    expectTypeOf(walletMethod).returns.toEqualTypeOf<IRecoveryMethod>();
  });

  it('returns an object with exactly the ten members and nothing else', () => {
    expect(membersOf(walletMethod())).toEqual(TEN_MEMBERS);
  });

  it('the six calls are functions and the three values are values', () => {
    const method = walletMethod();

    for (const name of ['modules', 'enrollInput', 'configFrom', 'signingInput', 'replyFrom', 'verify', 'describe'] as const) {
      expect(typeof method[name]).toBe('function');
    }

    expect(typeof method.codec).toBe('object');
    expect(typeof method.deviceBinding).toBe('string');
    expect(Array.isArray(method.vector)).toBe(true);
  });

  it('does not export the class itself, only the factory', () => {
    expect(Object.keys(core)).not.toContain('WalletMethod');
  });
});

describe('modules(descriptor)', () => {
  it('answers the descriptor\'s method-ecdsa address, as a list', () => {
    const address: Address = '0x00000000000000000000000000000000000000ec';

    expect(walletMethod().modules(descriptor(address))).toEqual([address]);
  });

  it('follows the descriptor it is given, nothing held', () => {
    const method = walletMethod();
    const other: Address = '0x00000000000000000000000000000000000000ed';

    expect(method.modules(descriptor(other))).toEqual([other]);
  });
});

describe('the three values', () => {
  it('deviceBinding is none', () => {
    expect(walletMethod().deviceBinding).toBe('none');
  });

  it('vector names the two copied vector files', () => {
    expect([...walletMethod().vector].sort()).toEqual(['method-ecdsa-config.json', 'method-ecdsa-proof.json']);
  });
});

describe('describe(ctx)', () => {
  it('states the device kind of a wallet signing typed data', () => {
    expect(walletMethod().describe(ctxFor()).kind).toBe('typed-data-wallet');
  });

  it('states the guardian\'s address', () => {
    const facts = walletMethod().describe(ctxFor());
    const addresses = Object.values(facts).filter((value): value is string => typeof value === 'string' && value.startsWith('0x'));

    expect(addresses.map((value) => value.toLowerCase())).toContain(SIGNER_ONE.toLowerCase());
  });

  it('states that the SDK cannot tell a key from a contract, whatever credentialHoldsCode says', () => {
    const method = walletMethod();
    const asKey = method.describe(ctxFor({ credentialHoldsCode: false }));
    const asContract = method.describe(ctxFor({ credentialHoldsCode: true }));

    // DeviceFacts is open, so the fact's name is this implementation's choice.
    expect(asKey['keyOrContractKnown']).toBe(false);
    expect(asContract).toStrictEqual(asKey);
  });

  it('never throws on a config that does not decode, and still states its kind', () => {
    const facts = walletMethod().describe(ctxFor({ config: '0x12' }));

    expect(facts.kind).toBe('typed-data-wallet');
  });

  it('states values only: nothing callable', () => {
    const facts = walletMethod().describe(ctxFor({ config: addressWord(SIGNER_ONE) }));

    for (const value of Object.values(facts)) expect(typeof value).not.toBe('function');
  });
});

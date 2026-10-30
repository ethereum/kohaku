import fc from 'fast-check';
import type { Address, Configuration, Credential, Hex } from '../../src/index';
import {
  attemptIn,
  ecdsaConfig,
  GUARDIAN_A,
  GUARDIAN_B,
  KEY_OTHER,
  METHOD_ECDSA,
  METHOD_OTHER,
  METHOD_PASSKEY,
  partiesWith,
  PAUSER,
  stateFor,
  world,
  ZERO,
  type World,
} from './doubles';

export const METHODS = [METHOD_ECDSA, METHOD_PASSKEY, METHOD_OTHER] as const;
export const GUARDIANS = [GUARDIAN_A, GUARDIAN_B, KEY_OTHER] as const;

const toHex = (bytes: Uint8Array): Hex => `0x${Buffer.from(bytes).toString('hex')}`;

const credential: fc.Arbitrary<Credential> = fc
  .record({
    method: fc.constantFrom(...METHODS),
    guardian: fc.constantFrom(...GUARDIANS),
    bytes: fc.uint8Array({ maxLength: 8 }).map(toHex),
    salt: fc.option(fc.uint8Array({ minLength: 32, maxLength: 32 }).map(toHex), { nil: undefined }),
    label: fc.option(fc.string({ maxLength: 6 }), { nil: undefined }),
  })
  .map(({ method, guardian, bytes, salt, label }) => ({
    method,
    config: method === METHOD_ECDSA ? ecdsaConfig(guardian) : bytes,
    ...(salt === undefined ? {} : { salt }),
    ...(label === undefined ? {} : { label }),
  }));

/** Configurations of one to three clauses over the three test methods and three guardians. */
export const configuration: fc.Arbitrary<Configuration> = fc.record({
  clauses: fc.array(
    fc.array(credential, { minLength: 1, maxLength: 3 }).chain((credentials) =>
      fc.integer({ min: 1, max: credentials.length }).map((threshold) => ({ threshold, credentials })),
    ),
    { minLength: 1, maxLength: 3 },
  ),
  wait: fc.integer({ min: 0, max: 2 ** 32 }),
  ignoresPause: fc.boolean(),
});

/** Per method its stop and pause holder, per guardian its code, and the pinned block and window. */
export const chain = fc.record({
  paused: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
  holders: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
  code: fc.tuple(fc.boolean(), fc.boolean(), fc.boolean()),
  number: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  timestamp: fc.integer({ min: 0, max: 2 ** 40 }),
  window: fc.integer({ min: 1, max: 2 ** 30 }),
  hash: fc.uint8Array({ minLength: 32, maxLength: 32 }).map(toHex),
});

export type Chain = typeof chain extends fc.Arbitrary<infer T> ? T : never;

/** Every value lower-cased as a string. */
export const lowered = (values: readonly unknown[]): string[] => values.map((value) => String(value).toLowerCase());

/** The world the chain facts describe, an attempt waiting where the init cancels. */
export const worldOf = (config: Configuration, facts: Chain, cancelling: boolean): World =>
  world({
    header: { number: facts.number, timestamp: facts.timestamp, hash: facts.hash },
    state: stateFor(config, cancelling ? attemptIn('Waiting', 9n, facts.timestamp) : attemptIn('None')),
    paused: new Map(METHODS.map((method, index) => [method.toLowerCase(), { answered: true as const, value: facts.paused[index] as boolean }])),
    parties: new Map(METHODS.map((method, index) => [method.toLowerCase(), { answered: true as const, value: partiesWith(facts.holders[index] ? PAUSER : ZERO) }])),
    code: new Map(GUARDIANS.map((guardian, index) => [guardian.toLowerCase(), (facts.code[index] ? '0x60' : '0x') as Hex])),
  });

/** The position of an address in a list, ignoring case. */
export const indexOf = (list: readonly Address[], value: string): number => lowered(list).indexOf(value.toLowerCase());

/** The guardian address a wallet config word holds. */
export const guardianOf = (config: Hex): string => `0x${config.slice(-40)}`;

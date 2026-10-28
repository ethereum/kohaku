import { describe, expect, it } from 'vitest';
import type { Address, FilterSpec, FilterTopic, Hex } from '../../src/index';
import {
  ACCOUNT,
  ACTION,
  addressTopic,
  DESCRIPTOR,
  makeReader,
  MANAGER,
  MANAGER_EVENT_NAMES,
  METHOD_AADHAAR,
  METHOD_ECDSA,
  METHOD_EVENT_NAMES,
  METHOD_PASSKEY,
  METHOD_ZKPASSPORT,
  REGISTERED_MODULE,
  selectorOf,
  SHIPPED_EXTRA,
  TOPIC0,
} from './fixture';

const sortedLower = (values: readonly string[]): string[] => values.map((value) => value.toLowerCase()).sort();

/** A topic position as the set of values it admits, `null` meaning open. */
const admits = (topic: FilterTopic | undefined): string[] | null => {
  if (topic === undefined || topic === null) return null;

  return sortedLower(typeof topic === 'string' ? [topic] : topic);
};

const MANAGER_TOPICS = sortedLower(MANAGER_EVENT_NAMES.map((name) => TOPIC0[name]));
const METHOD_TOPICS = sortedLower(METHOD_EVENT_NAMES.map((name) => TOPIC0[name]));

const onlyAddressesAndTopics = (filter: FilterSpec): void => {
  expect(Object.keys(filter).sort()).toEqual(['address', 'topics']);
  // Plain strings, arrays and nulls: no client library object survives a JSON round trip unchanged otherwise.
  expect(JSON.parse(JSON.stringify(filter))).toEqual(filter);
};

describe('the derived topic hashes', () => {
  it('each written-out topic0 is keccak256 of the derived signature', () => {
    for (const [name, topic] of Object.entries(TOPIC0)) {
      expect(selectorOf(name as keyof typeof TOPIC0), name).toBe(topic);
    }
  });
});

describe('accountFilter', () => {
  const reader = makeReader();

  it("names the manager's address alone", () => {
    expect(sortedLower(reader.accountFilter().address)).toEqual(sortedLower([MANAGER]));
  });

  it('selects the five manager events, the account first and the action second', () => {
    const { topics } = reader.accountFilter();

    expect(admits(topics[0])).toEqual(MANAGER_TOPICS);
    expect(admits(topics[1])).toEqual([addressTopic(ACCOUNT)]);
    expect(admits(topics[2])).toEqual([addressTopic(ACTION)]);
    expect(topics.slice(3).every((topic) => topic === null)).toBe(true);
    onlyAddressesAndTopics(reader.accountFilter());
  });

  it('the option left false is the default filter', () => {
    expect(reader.accountFilter({ allActions: false })).toEqual(reader.accountFilter());
    expect(reader.accountFilter({})).toEqual(reader.accountFilter());
  });

  it('allActions keeps the address, the events and the account and opens the action topic', () => {
    const open = reader.accountFilter({ allActions: true });

    expect(sortedLower(open.address)).toEqual(sortedLower([MANAGER]));
    expect(admits(open.topics[0])).toEqual(MANAGER_TOPICS);
    expect(admits(open.topics[1])).toEqual([addressTopic(ACCOUNT)]);
    expect(admits(open.topics[2])).toBeNull();
    expect(open.topics.slice(3).every((topic) => topic === null)).toBe(true);
    onlyAddressesAndTopics(open);
  });

  it('every topic value is a 32-byte hex string', () => {
    const values = reader.accountFilter().topics.flatMap((topic) => (topic === null ? [] : typeof topic === 'string' ? [topic] : [...topic]));

    for (const value of values) expect(value).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});

describe('methodFilter', () => {
  const reader = makeReader();
  const expected: Address[] = [METHOD_ECDSA, METHOD_PASSKEY, METHOD_AADHAAR, METHOD_ZKPASSPORT, SHIPPED_EXTRA, REGISTERED_MODULE];

  it("names the descriptor's methods and the registered modules, each once", () => {
    const { address } = reader.methodFilter();

    expect(sortedLower(address)).toEqual(sortedLower(expected));
    expect(new Set(sortedLower(address)).size).toBe(address.length);
  });

  it('names neither the manager, the action nor the account', () => {
    const address = sortedLower(reader.methodFilter().address);

    for (const excluded of [MANAGER, ACTION, DESCRIPTOR.action, ACCOUNT]) expect(address).not.toContain(excluded.toLowerCase());
  });

  it('selects the eight method events and no indexed field', () => {
    const { topics } = reader.methodFilter();

    expect(admits(topics[0])).toEqual(METHOD_TOPICS);
    expect(topics.slice(1).every((topic) => topic === null)).toBe(true);
    onlyAddressesAndTopics(reader.methodFilter());
  });

  it('follows the registry: an empty registry leaves only the descriptor methods', () => {
    const bare = makeReader(undefined, 1000, new Map());

    expect(sortedLower(bare.methodFilter().address)).toEqual(sortedLower(expected.filter((entry) => entry !== REGISTERED_MODULE)));
  });
});

describe('privilegeFilter', () => {
  const reader = makeReader();

  it("names the account's own address with the one LogPrivilegeChanged topic", () => {
    const filter = reader.privilegeFilter();

    expect(sortedLower(filter.address)).toEqual(sortedLower([ACCOUNT]));
    expect(admits(filter.topics[0])).toEqual([TOPIC0.LogPrivilegeChanged as Hex]);
    expect(filter.topics.slice(1).every((topic) => topic === null)).toBe(true);
    onlyAddressesAndTopics(filter);
  });
});

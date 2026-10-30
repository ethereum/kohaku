import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { creationPrivileges, type Address } from '../../src/index';
import { address, bytesN, run, TIMEOUT } from './arbitraries';
import { buildCreationCode, builderCreationCode, create2ByHand, expectedPrivileges, type HandEntry } from './request-support';

/** A stored value's push bytes, one to thirty-two, as the builder may emit them. */
const valueBytes = fc.uint8Array({ minLength: 1, maxLength: 32 }).map((b) => Buffer.from(b).toString('hex'));

const entry: fc.Arbitrary<HandEntry> = fc.record({ addr: address, valueBytes });

/** An implementation address, often with leading zero bytes, kept by a full PUSH20. */
const implementation: fc.Arbitrary<Address> = fc
  .tuple(fc.nat(19), bytesN(20))
  .map(([zeros, raw]) => `0x${'00'.repeat(zeros)}${raw.slice(2 + zeros * 2).replace(/^00/, '01')}` as Address);

/** An implementation address with one to nineteen leading zero bytes, which the pinned builder pushes short. */
const zeroLedImplementation: fc.Arbitrary<Address> = fc
  .tuple(fc.integer({ min: 1, max: 19 }), bytesN(20))
  .map(([zeros, raw]) => `0x${'00'.repeat(zeros)}${raw.slice(2 + zeros * 2).replace(/^00/, '01')}` as Address);

describe('creation privileges', () => {
  it('equals the hand-built CREATE2 address and the entries in code order', () => {
    run(
      fc.property(address, implementation, fc.array(entry, { maxLength: 3 }), bytesN(32), (factory, impl, entries, salt) => {
        const code = buildCreationCode(impl, entries);

        expect(creationPrivileges(factory, code, salt)).toStrictEqual(
          expectedPrivileges(create2ByHand(factory, salt, code), entries),
        );
      }),
    );
  }, TIMEOUT);

  it('refuses the pinned builder\'s short implementation push at the push\'s own byte', () => {
    run(
      fc.property(address, zeroLedImplementation, fc.array(entry, { maxLength: 3 }), bytesN(32), (factory, impl, entries, salt) => {
        const code = builderCreationCode(impl, entries);
        const implementationAt = entries.reduce((at, e) => at + e.valueBytes.length / 2 + 35, 0) + 19;

        expect(code).not.toBe(buildCreationCode(impl, entries));
        expect(() => creationPrivileges(factory, code, salt)).toThrow(
          new RangeError(`bytecode does not push the implementation at byte ${implementationAt} as exactly 20 bytes`),
        );
      }),
    );
  }, TIMEOUT);

  it('refuses the same code with bytes appended or a fourth entry', () => {
    run(
      fc.property(address, implementation, fc.array(entry, { minLength: 4, maxLength: 5 }), bytesN(32), bytesN(1), (factory, impl, entries, salt, extra) => {
        const code = buildCreationCode(impl, entries.slice(0, 3));

        expect(() => creationPrivileges(factory, `${code}${extra.slice(2)}`, salt)).toThrow();
        expect(() => creationPrivileges(factory, buildCreationCode(impl, entries), salt)).toThrow();
      }),
    );
  }, TIMEOUT);
});

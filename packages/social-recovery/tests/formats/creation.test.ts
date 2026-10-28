import { describe, expect, it } from 'vitest';
import { creationPrivileges, type Address, type Hex } from '../../src/index';
import {
  AMBIRE_FACTORY,
  AMBIRE_IMPL,
  buildCreationCode,
  builderCreationCode,
  create2ByHand,
  create2Viem,
  expectedPrivileges,
  LEADING_ZERO_IMPL,
  privilegeSlot,
  SIGNER_VALUE_WORD,
  trimmedImpl,
  type HandEntry,
} from './request-support';
import { repeat } from './support';

const OWNER: Address = '0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const SECOND: Address = '0x4444444444444444444444444444444444444444';
const THIRD: Address = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
const ZERO_SALT = repeat('00', 32);
const SIGNER: HandEntry = { addr: OWNER, valueBytes: SIGNER_VALUE_WORD };

/** With one full-width signer entry the stores take 67 bytes and the deploy code 10, so the runtime starts at 77 and the implementation push at 86. */
const IMPLEMENTATION_REFUSAL = 'bytecode does not push the implementation at byte 86 as exactly 20 bytes';

/** The runtime starts at byte 77, and the offset byte is overwritten with 0x4e, which is 78. */
const OFFSET_REFUSAL = "bytecode's runtime offset 78 is not its runtime's start 77";

/** The first entry's value push is a PUSH32, so its slot push opens at byte 33. */
const SLOT_REFUSAL = 'bytecode does not push the storage slot at byte 33 as exactly 32 bytes';

const check = (factory: Address, code: Hex, salt: Hex, entries: readonly HandEntry[]): void => {
  const account = create2Viem(factory, salt, code);

  expect(create2ByHand(factory, salt, code)).toBe(account);
  expect(creationPrivileges(factory, code, salt)).toStrictEqual(expectedPrivileges(account, entries));
};

describe('creationPrivileges', () => {
  it('reads a fresh account: one signer entry at value 2 under the reference factory and implementation', () => {
    const code = buildCreationCode(AMBIRE_IMPL, [SIGNER]);
    const result = creationPrivileges(AMBIRE_FACTORY, code, ZERO_SALT);

    check(AMBIRE_FACTORY, code, ZERO_SALT, [SIGNER]);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.slot).toBe(privilegeSlot(OWNER));
    expect(result.entries[0]?.value).toBe(`0x${'0'.repeat(63)}2`);
  });

  it.each([
    ['two entries', [SIGNER, { addr: SECOND, valueBytes: '01' }]],
    ['three entries', [{ addr: OWNER, valueBytes: '02' }, { addr: SECOND, valueBytes: '01' }, { addr: THIRD, valueBytes: 'abcd' }]],
    ['a value pushed at full width with no leading zero', [{ addr: SECOND, valueBytes: 'ff'.repeat(32) }]],
    ['no entry at all', []],
  ])('reads %s in code order', (_label, entries) => {
    check(AMBIRE_FACTORY, buildCreationCode(AMBIRE_IMPL, entries as HandEntry[]), repeat('ab', 32), entries as HandEntry[]);
  });

  it('reads a leading-zero implementation pushed as a full PUSH20 with its zero bytes kept', () => {
    const code = buildCreationCode(LEADING_ZERO_IMPL, [SIGNER]);

    expect(code).toContain('730000000071727de22e5e9d8baf0edac6f37da0325af4');
    check(AMBIRE_FACTORY, code, ZERO_SALT, [SIGNER]);
  });

  it('refuses the pinned builder\'s own output for a leading-zero implementation, a PUSH16 the proxy cannot run', () => {
    const code = builderCreationCode(LEADING_ZERO_IMPL, [SIGNER]);

    expect(trimmedImpl(LEADING_ZERO_IMPL)).toHaveLength(32);
    expect(code).toContain(`6f${trimmedImpl(LEADING_ZERO_IMPL)}5af4`);
    expect(() => creationPrivileges(AMBIRE_FACTORY, code, ZERO_SALT)).toThrow(new RangeError(IMPLEMENTATION_REFUSAL));
  });

  it('gives the same code from the builder port and the padded assembler when the implementation has no leading zero', () => {
    expect(builderCreationCode(AMBIRE_IMPL, [SIGNER])).toBe(buildCreationCode(AMBIRE_IMPL, [SIGNER]));
  });

  it('changes the account with the salt, the factory and the code, never the entries', () => {
    const code = buildCreationCode(AMBIRE_IMPL, [SIGNER]);
    const base = creationPrivileges(AMBIRE_FACTORY, code, ZERO_SALT);
    const others = [
      creationPrivileges(AMBIRE_FACTORY, code, repeat('01', 32)),
      creationPrivileges(SECOND, code, ZERO_SALT),
      creationPrivileges(AMBIRE_FACTORY, buildCreationCode(LEADING_ZERO_IMPL, [SIGNER]), ZERO_SALT),
    ];

    for (const other of others) {
      expect(other.account).not.toBe(base.account);
      expect(other.entries).toStrictEqual(base.entries);
    }
  });

  it('accepts every valid spelling of the factory alike and returns the account checksummed', () => {
    const code = buildCreationCode(AMBIRE_IMPL, [SIGNER]);
    const expected = creationPrivileges(AMBIRE_FACTORY, code, ZERO_SALT);

    expect(creationPrivileges(AMBIRE_FACTORY.toLowerCase() as Hex, code, ZERO_SALT)).toStrictEqual(expected);
    expect(creationPrivileges(`0x${AMBIRE_FACTORY.slice(2).toUpperCase()}`, code.toUpperCase().replace('0X', '0x') as Hex, ZERO_SALT)).toStrictEqual(expected);
    expect(() => creationPrivileges('0x26CE6745A633030A6faC5e64e41D21fb6246dc2d', code, ZERO_SALT)).toThrow();
  });

  it.each([
    ['a 31-byte salt', repeat('00', 31)],
    ['a 33-byte salt', repeat('00', 33)],
    ['an unprefixed salt', '00'.repeat(32)],
  ])('refuses %s', (_label, salt) => {
    expect(() => creationPrivileges(AMBIRE_FACTORY, buildCreationCode(AMBIRE_IMPL, [SIGNER]), salt as Hex)).toThrow();
  });
});

describe('creationPrivileges refuses bytecode that does not parse as the proxy layout', () => {
  const good = buildCreationCode(AMBIRE_IMPL, [SIGNER]);
  const four = buildCreationCode(AMBIRE_IMPL, [SIGNER, SIGNER, SIGNER, SIGNER]);
  const runtimeAt = good.indexOf('3d602d80');
  const slotPush = good.indexOf('7f', 2 + 66);

  it.each([
    ['empty code', '0x'],
    ['odd-length hex', `${good}0`],
    ['a trailing byte', `${good}00`],
    ['a truncated runtime tail', good.slice(0, -2)],
    ['a changed runtime tail', `${good.slice(0, -2)}f4`],
    ['a changed runtime head', good.replace('363d3d373d3d3d363d', '363d3d373d3d3d363e')],
    ['a changed deploy code', good.replace('3d3981f3', '3d3981f4')],
    ['a wrong runtime offset', `${good.slice(0, runtimeAt + 10)}ff${good.slice(runtimeAt + 12)}`],
    ['four entries', four],
    ['an entry with no SSTORE', good.replace(`${privilegeSlot(OWNER).slice(2)}55`, `${privilegeSlot(OWNER).slice(2)}56`)],
    ['a slot pushed as 31 bytes', `${good.slice(0, slotPush)}7e${good.slice(slotPush + 4)}`],
    ['a value that is not a push', `0x5b${good.slice(4)}`],
    ['an implementation pushed as 21 bytes with a leading zero byte', good.replace(`73${AMBIRE_IMPL.slice(2).toLowerCase()}`, `74${'00'}${AMBIRE_IMPL.slice(2).toLowerCase()}`)],
    ['an implementation pushed as 21 bytes', good.replace(`73${AMBIRE_IMPL.slice(2).toLowerCase()}`, `74ff${AMBIRE_IMPL.slice(2).toLowerCase()}`)],
    ['the runtime alone', `0x${good.slice(runtimeAt + 20)}`],
    ['stray bytes before the entries', `0x00${good.slice(2)}`],
  ])('refuses %s', (_label, code) => {
    expect(code).not.toBe(good);
    expect(() => creationPrivileges(AMBIRE_FACTORY, code as Hex, ZERO_SALT)).toThrow();
  });
});

describe('creationPrivileges names the push it refuses', () => {
  const good = buildCreationCode(AMBIRE_IMPL, [SIGNER]);
  const implAt = 2 + 86 * 2;
  const slotAt = 2 + 33 * 2;
  const runtimeAt = good.indexOf('3d602d80');
  const impl = AMBIRE_IMPL.slice(2).toLowerCase();

  it('finds the implementation push and the slot push where the layout puts them', () => {
    expect(good.slice(implAt, implAt + 42)).toBe(`73${impl}`);
    expect(good.slice(slotAt, slotAt + 2)).toBe('7f');
    expect(runtimeAt).toBe(2 + 67 * 2);
  });

  it.each(Array.from({ length: 19 }, (_unused, index) => index + 1))(
    'refuses the implementation pushed as %i bytes with the one implementation message',
    (width) => {
      const short = `${(0x5f + width).toString(16)}${impl.slice(-width * 2)}`;
      const code = `${good.slice(0, implAt)}${short}${good.slice(implAt + 42)}` as Hex;

      expect(() => creationPrivileges(AMBIRE_FACTORY, code, ZERO_SALT)).toThrow(new RangeError(IMPLEMENTATION_REFUSAL));
    },
  );

  it.each([
    ['a PUSH21', `74ff${impl}`],
    ['a PUSH32', `7f${'00'.repeat(12)}${impl}`],
    ['a non-push byte before the address', `5b${impl}`],
  ])('refuses the implementation as %s with the same message', (_label, replacement) => {
    const code = `${good.slice(0, implAt)}${replacement}${good.slice(implAt + 42)}` as Hex;

    expect(() => creationPrivileges(AMBIRE_FACTORY, code, ZERO_SALT)).toThrow(new RangeError(IMPLEMENTATION_REFUSAL));
  });

  it('keeps a distinct refusal for a wrong runtime offset under a full PUSH20', () => {
    const code = `${good.slice(0, runtimeAt + 10)}4e${good.slice(runtimeAt + 12)}` as Hex;

    expect(code).toContain(`73${impl}`);
    expect(() => creationPrivileges(AMBIRE_FACTORY, code, ZERO_SALT)).toThrow(new RangeError(OFFSET_REFUSAL));
  });

  it.each([
    ['a PUSH31', '7e'],
    ['a PUSH1', '60'],
    ['a PUSH20', '73'],
    ['a JUMPDEST', '5b'],
    ['a STOP', '00'],
  ])('refuses a slot pushed by %s with the one slot message', (_label, opcode) => {
    const code = `${good.slice(0, slotAt)}${opcode}${good.slice(slotAt + 2)}` as Hex;

    expect(() => creationPrivileges(AMBIRE_FACTORY, code, ZERO_SALT)).toThrow(new RangeError(SLOT_REFUSAL));
  });

  it('refuses a PUSH32 slot cut short by the end of the code with the same slot message', () => {
    const code = good.slice(0, slotAt + 2 + 20) as Hex;

    expect(() => creationPrivileges(AMBIRE_FACTORY, code, ZERO_SALT)).toThrow(new RangeError(SLOT_REFUSAL));
  });
});

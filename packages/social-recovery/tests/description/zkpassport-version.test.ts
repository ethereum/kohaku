import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as core from '../../src';
import {
  METHOD_ZKPASSPORT_VERSION_KEY,
  METHOD_ZKPASSPORT_VERSION_PART_BYTES,
  METHOD_ZKPASSPORT_VERSION_PARTS,
} from '../../src/constants/method-zkpassport';
import { zkPassportVersionOf, zkPassportVersionWord } from '../../src/description';
import type { Hex } from '../../src/interfaces';
import { jsDocOf, PACKAGE_ROOT, SRC_ROOT } from '../helpers/source';

const ZEROS = (bytes: number): string => '00'.repeat(bytes);

/** The deploy script's accepted version, 0.21.0: three big-endian `uint16` in the first six bytes, zero in the rest. */
const WORD_0_21_0: Hex = `0x000000150000${ZEROS(26)}`;
const WORD_0_21_1: Hex = `0x000000150001${ZEROS(26)}`;

/** The peer's rule written out here: `split('.')`, `Number`, two big-endian bytes each, hex padded to 64 digits. */
const peerRule = (version: string): Hex =>
  `0x${version
    .split('.')
    .map((part) => Number(part).toString(16).padStart(4, '0'))
    .join('')
    .padEnd(64, '0')}`;

const uint16 = fc.integer({ min: 0, max: 65_535 });

describe('the version constants', () => {
  it('word 0 of the trusted keys, three parts of two bytes each', () => {
    expect(METHOD_ZKPASSPORT_VERSION_KEY).toBe(0);
    expect(METHOD_ZKPASSPORT_VERSION_PARTS).toBe(3);
    expect(METHOD_ZKPASSPORT_VERSION_PART_BYTES).toBe(2);
  });

  it('come from the core entry, with the two functions', () => {
    const entry = core as { readonly [name: string]: unknown };

    expect(entry['zkPassportVersionOf']).toBe(zkPassportVersionOf);
    expect(entry['zkPassportVersionWord']).toBe(zkPassportVersionWord);
    expect(entry['METHOD_ZKPASSPORT_VERSION_KEY']).toBe(0);
    expect(entry['METHOD_ZKPASSPORT_VERSION_PARTS']).toBe(3);
    expect(entry['METHOD_ZKPASSPORT_VERSION_PART_BYTES']).toBe(2);
  });
});

describe('zkPassportVersionOf and zkPassportVersionWord', () => {
  it.each([
    [WORD_0_21_0, '0.21.0'],
    [WORD_0_21_1, '0.21.1'],
    [`0x000000150002${ZEROS(26)}` as Hex, '0.21.2'],
    [`0x${ZEROS(32)}` as Hex, '0.0.0'],
    [`0xffffffffffff${ZEROS(26)}` as Hex, '65535.65535.65535'],
    [`0x000100020003${ZEROS(26)}` as Hex, '1.2.3'],
  ])('%s is version %s, and back', (word, version) => {
    expect(zkPassportVersionOf(word)).toBe(version);
    expect(zkPassportVersionWord(version)).toBe(word);
  });

  it('writes lower-case hex, as the peer does', () => {
    expect(zkPassportVersionWord('0.21.171')).toBe(`0x0000001500ab${ZEROS(26)}`);
  });

  it('round-trips any three uint16 parts through the word', () => {
    fc.assert(
      fc.property(uint16, uint16, uint16, (major, minor, patch) => {
        const version = `${major}.${minor}.${patch}`;
        const word = zkPassportVersionWord(version);

        expect(word).toMatch(/^0x[0-9a-f]{12}0{52}$/);
        expect(zkPassportVersionOf(word)).toBe(version);
        expect(BigInt(word) >> 208n).toBe((BigInt(major) << 32n) | (BigInt(minor) << 16n) | BigInt(patch));
      }),
    );
  });

  it('writes the word the peer\'s own rule writes, for any three uint16 parts', () => {
    fc.assert(
      fc.property(uint16, uint16, uint16, (major, minor, patch) => {
        const version = `${major}.${minor}.${patch}`;

        expect(zkPassportVersionWord(version)).toBe(peerRule(version));
      }),
    );
  });

  it.each([
    ['a short word', `0x0000001500`],
    ['a 33-byte word', `0x000000150000${ZEROS(27)}`],
    ['a non-zero last byte', `0x000000150000${ZEROS(25)}01`],
    ['a non-zero seventh byte', `0x00000015000001${ZEROS(25)}`],
    ['no 0x prefix', `000000150000${ZEROS(26)}`],
    ['a non-hex digit', `0x00000015000g${ZEROS(26)}`],
    ['no string at all', 21],
  ])('zkPassportVersionOf throws a TypeError on %s', (_case, word) => {
    expect(() => zkPassportVersionOf(word as Hex)).toThrow(TypeError);
  });

  it.each([
    ['two parts', '0.21'],
    ['four parts', '0.21.0.1'],
    ['a part of 65536', '0.65536.0'],
    ['a negative part', '-1.21.0'],
    ['an empty part', '0..0'],
    ['a letter', '0.21.x'],
    ['a prefix v', 'v0.21.0'],
    ['the empty string', ''],
    ['no string at all', 210],
  ])('zkPassportVersionWord throws a TypeError on %s', (_case, version) => {
    expect(() => zkPassportVersionWord(version as string)).toThrow(TypeError);
  });
});

describe('the peer\'s params.version is this word', () => {
  /** `@zkpassport/sdk` 0.17.1's built module, read as text, never run. */
  const peerSource = (): string => readFileSync(join(PACKAGE_ROOT, 'node_modules', '@zkpassport', 'sdk', 'dist', 'esm', 'index.js'), 'utf8');

  it('the installed peer splits the version on dots, writes each part as two big-endian bytes and pads the hex to 64 digits', () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'node_modules', '@zkpassport', 'sdk', 'package.json'), 'utf8')) as { readonly version?: string };
    const source = peerSource();

    expect(manifest.version).toBe('0.17.1');
    const rule = /(\w+)=\w+\.version\?\.split\("\."\)\.map\(\w+=>Number\(\w+\)\);if\(!\1\|\|\1\.length!==3\)throw new Error\("Invalid version format"\);let (\w+)=new Uint8Array\(\[\.\.\.numberToBytesBE\(\1\[0\],2\),\.\.\.numberToBytesBE\(\1\[1\],2\),\.\.\.numberToBytesBE\(\1\[2\],2\)\]\);return \{version:`0x\$\{bytesToHex\(\2\)\.padEnd\(64,"0"\)\}`/;

    expect(source).toMatch(rule);
  });
});

describe('the documentation', () => {
  const versionFile = join(SRC_ROOT, 'description', 'zkpassport-version.ts');

  it.each(['zkPassportVersionOf', 'zkPassportVersionWord'])('%s carries a JSDoc naming its TypeError', (name) => {
    const doc = jsDocOf(versionFile, name);

    expect(doc).not.toBe('');
    expect(doc).toContain('TypeError');
  });

  it('the decoder\'s JSDoc says the peer\'s params.version is the word to compare with trustedKeys[METHOD_ZKPASSPORT_VERSION_KEY]', () => {
    const doc = jsDocOf(versionFile, 'zkPassportVersionOf');

    expect(doc).toContain('params.version');
    expect(doc).toContain('trustedKeys[METHOD_ZKPASSPORT_VERSION_KEY]');
  });

  it('ZkPassportVerifierParameters.version names the trusted-key word it equals', () => {
    const doc = jsDocOf(join(SRC_ROOT, 'types', 'method-zkpassport.ts'), 'version', 'ZkPassportVerifierParameters');

    expect(doc).toContain('trustedKeys[METHOD_ZKPASSPORT_VERSION_KEY]');
  });
});

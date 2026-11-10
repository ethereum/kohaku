import { describe, it, expect, vi } from 'vitest';
import { MnemonicKeystore } from '../src/host/mnemonic-keystore';
import { parseDerivationPath, HARDENED_OFFSET } from '../src/host/derivation-path';
import { KeystorePathNotAllowedError, scopeKeystore } from '../src/host/scoped-keystore';
import type { Keystore } from '../src/host';

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';
const MAIN_WALLET_PATH = "m/44'/60'/0'/0/0";
const MAIN_WALLET_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TORNADO_PREFIX = "m/29795'/1'";

describe('parseDerivationPath', () => {
  it('parses hardened and normal segments', () => {
    expect(parseDerivationPath("m/44'/60h/0")).toEqual([44 + HARDENED_OFFSET, 60 + HARDENED_OFFSET, 0]);
  });

  it.each([
    ['m', 'master key (depth 0)'],
    ['', 'empty'],
    ["44'/60'", 'missing m/'],
    ["M/44'", 'upper-case M'],
    ["m/44'/1984'/0abc'", 'trailing junk'],
    ["m/44'/1e3'", 'exponent'],
    ["m/44'/0x10'", 'hex'],
    ["m/44'/-1", 'negative'],
    ["m/44'/ 1'", 'whitespace'],
    ["m/44'/01'", 'leading zero'],
    ["m/44''", 'double apostrophe'],
    ["m/44H", 'upper-case H'],
    ['m/44/', 'empty segment'],
    ['m//44', 'empty segment'],
    ['m/2147483648', 'index out of range'],
    [`m/${'0/'.repeat(255)}0`, 'deeper than 255'],
  ])('rejects %j (%s)', (path) => {
    expect(() => parseDerivationPath(path)).toThrow(/Invalid/);
  });

  it('rejects non-strings', () => {
    expect(() => parseDerivationPath(42 as unknown as string)).toThrow(/Invalid/);
  });
});

describe('MnemonicKeystore policy', () => {
  it('rejects a mnemonic with a bad checksum', () => {
    expect(() => new MnemonicKeystore('test test test test test test test test test test test test')).toThrow(/checksum/);
  });

  it.each(['', 'hello', `${TEST_MNEMONIC} `, TEST_MNEMONIC.replace(' ', '  ')])('rejects %j', (phrase) => {
    expect(() => new MnemonicKeystore(phrase)).toThrow(/Invalid mnemonic/);
  });

  it('does not expose the phrase as a property', () => {
    const keystore = new MnemonicKeystore(TEST_MNEMONIC);

    expect(Object.values(keystore)).not.toContain(TEST_MNEMONIC);
    expect((keystore as unknown as { mnemonic?: string }).mnemonic).toBeUndefined();
  });

  it('refuses malformed paths and the master key instead of guessing', async () => {
    const keystore = new MnemonicKeystore(TEST_MNEMONIC);

    await expect(keystore.deriveAt("m/44'/1984'/0abc'/0'/0'")).rejects.toThrow(/Invalid path segment/);
    await expect(keystore.deriveAt("m/44'/1984'/1e3'")).rejects.toThrow(/Invalid path segment/);
    await expect(keystore.deriveAt('m')).rejects.toThrow(/Invalid derivation path/);
  });

  it("treats h like ' on BIP-32 paths", async () => {
    const keystore = new MnemonicKeystore(TEST_MNEMONIC);

    expect(await keystore.deriveAt('m/44h/60h/0h/0/0')).toBe(MAIN_WALLET_KEY);
  });
});

describe('scopeKeystore', () => {
  const inner = new MnemonicKeystore(TEST_MNEMONIC);

  it('derives below its prefixes and nothing else', async () => {
    const scoped = scopeKeystore(inner, { prefixes: [TORNADO_PREFIX] });

    expect(await scoped.deriveAt("m/29795'/1'/0'")).toBe(await inner.deriveAt("m/29795'/1'/0'"));
    expect(await scoped.deriveAt("m/29795'/1'/0'/1'/7'")).toMatch(/^0x[0-9a-f]{64}$/);

    for (const path of [MAIN_WALLET_PATH, "m/28784'/1'/0'", "m/29795'/2'/0'", "m/29795'", TORNADO_PREFIX, "m/44'/1984'/0'/0'/0'"]) {
      await expect(scoped.deriveAt(path), path).rejects.toThrow(KeystorePathNotAllowedError);
    }
  });

  it('allows exact paths only, not their subtree or parent', async () => {
    const scoped = scopeKeystore(inner, { prefixes: [TORNADO_PREFIX], paths: ["m/44'/60'/0'/0/3"] });

    expect(await scoped.deriveAt("m/44'/60'/0'/0/3")).toBe(await inner.deriveAt("m/44'/60'/0'/0/3"));
    expect(await scoped.deriveAt('m/44h/60h/0h/0/3')).toBe(await inner.deriveAt("m/44'/60'/0'/0/3"));
    await expect(scoped.deriveAt(MAIN_WALLET_PATH)).rejects.toThrow(KeystorePathNotAllowedError);
    await expect(scoped.deriveAt("m/44'/60'/0'/0/3/0")).rejects.toThrow(KeystorePathNotAllowedError);
    await expect(scoped.deriveAt("m/44'/60'/0'/0")).rejects.toThrow(KeystorePathNotAllowedError);
  });

  it('reads a caller-held Set on every call', async () => {
    const paths = new Set<string>();
    const scoped = scopeKeystore(inner, { prefixes: [TORNADO_PREFIX], paths });

    await expect(scoped.deriveAt("m/44'/60'/0'/0/3")).rejects.toThrow(KeystorePathNotAllowedError);
    paths.add("m/44'/60'/0'/0/3");
    await expect(scoped.deriveAt("m/44'/60'/0'/0/3")).resolves.toMatch(/^0x/);
  });

  it('rejects malformed paths before reaching the wrapped keystore', async () => {
    const deriveAt = vi.fn<Keystore['deriveAt']>().mockResolvedValue('0x01');
    const scoped = scopeKeystore({ deriveAt }, { prefixes: [TORNADO_PREFIX] });

    await expect(scoped.deriveAt("m/29795'/1'/0abc'")).rejects.toThrow(/Invalid path segment/);
    await expect(scoped.deriveAt({ toString: () => "m/29795'/1'/0'" } as unknown as string)).rejects.toThrow(/Invalid/);
    expect(deriveAt).not.toHaveBeenCalled();
  });

  it('hands out only deriveAt, frozen', () => {
    const scoped = scopeKeystore(inner, { prefixes: [TORNADO_PREFIX] });

    expect(Object.keys(scoped)).toEqual(['deriveAt']);
    expect(Object.isFrozen(scoped)).toBe(true);
  });
});

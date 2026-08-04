import { describe, it, expect } from 'vitest';
import { MnemonicKeystore } from '../src/host/mnemonic-keystore';

/**
 * Regression tests for RAILGUN key derivation.
 *
 * RAILGUN paths (coin type 1984') must use the engine's "babyjubjub seed"
 * HMAC-SHA512 tree (`@railgun-community/engine`, src/key-derivation/bip32.ts),
 * not BIP-32 secp256k1. Deriving them with BIP-32 yields unrelated keys and a
 * different 0zk address, making wallets incompatible with the RAILGUN
 * ecosystem (see issue: "RAILGUN keys derived with BIP-32 secp256k1 instead
 * of the engine's babyjubjub seed tree").
 *
 * Vectors below were cross-checked against the engine reference derivation
 * and circomlibjs eddsa.prv2pub for the spending public key.
 */

const TEST_MNEMONIC = 'test test test test test test test test test test test junk';

const SPENDING_PATH = "m/44'/1984'/0'/0'/0'";
const VIEWING_PATH = "m/420'/1984'/0'/0'/0'";

// Engine-compatible ("babyjubjub seed" tree) expected keys:
const EXPECTED_SPENDING_KEY = '0xb0958f8bc286ae0832fa83b01b719a225a07ce7b861ff311323f221667b3bd50';
const EXPECTED_VIEWING_KEY = '0x9da4b4f0b5493a6ba3f7df0611c3e0842f7e2bb3d640f313b235f1b75c1d80b9';

// What BIP-32 secp256k1 would (incorrectly) derive on the same mnemonic/paths.
// Kept as a canary: if these ever match, the RAILGUN routing has regressed.
const BIP32_SPENDING_KEY = '0x96efbf7ab4a508d87b20b9d32688fcb4ea6c7c87d9104888bc26631125c3ff73';
const BIP32_VIEWING_KEY = '0xe2534d5a961988d66177c2d2acc5b6be2dea2cd5f4830e4becab8a0b4e0fd6bf';

describe('MnemonicKeystore RAILGUN derivation (engine compatibility)', () => {
  const keystore = new MnemonicKeystore(TEST_MNEMONIC);

  it('derives the spending key with the engine "babyjubjub seed" tree', async () => {
    const key = await keystore.deriveAt(SPENDING_PATH);
    expect(key).toBe(EXPECTED_SPENDING_KEY);
    expect(key).not.toBe(BIP32_SPENDING_KEY);
  });

  it('derives the viewing key with the engine "babyjubjub seed" tree', async () => {
    const key = await keystore.deriveAt(VIEWING_PATH);
    expect(key).toBe(EXPECTED_VIEWING_KEY);
    expect(key).not.toBe(BIP32_VIEWING_KEY);
  });

  it('routes any coin type 1984\' path to the engine tree (key index > 0)', async () => {
    // Distinct hardened leaves must produce distinct keys within the engine tree.
    const k0 = await keystore.deriveAt("m/44'/1984'/0'/0'/0'");
    const k1 = await keystore.deriveAt("m/44'/1984'/0'/0'/1'");
    expect(k1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(k1).not.toBe(k0);
  });

  it('rejects non-hardened segments on RAILGUN paths', async () => {
    await expect(keystore.deriveAt("m/44'/1984'/0'/0/0")).rejects.toThrow(/hardened/);
  });
});

describe('MnemonicKeystore non-RAILGUN derivation (unchanged BIP-32)', () => {
  const keystore = new MnemonicKeystore(TEST_MNEMONIC);

  it('still derives EVM keys with standard BIP-32 secp256k1', async () => {
    // First account of the standard test mnemonic:
    // 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 (well-known dev key)
    const key = await keystore.deriveAt("m/44'/60'/0'/0/0");
    expect(key).toBe('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
  });
});

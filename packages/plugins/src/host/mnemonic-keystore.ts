import { Keystore } from "./index";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { Hex } from "ox";

/** RAILGUN registered coin type (SLIP-0044). */
const RAILGUN_COIN_TYPE = 1984;
const HARDENED_OFFSET = 0x80000000;

/**
 * Parses a BIP-32 style path ("m/44'/1984'/0'/0'/0'") into raw u32 indices
 * (hardened offset applied).
 */
function parsePath(path: string): number[] {
    const segments = path.split("/");
    if (segments[0] !== "m") throw new Error(`Invalid derivation path: ${path}`);

    return segments.slice(1).map((segment) => {
        const hardened = segment.endsWith("'") || segment.endsWith("h");
        const index = Number.parseInt(hardened ? segment.slice(0, -1) : segment, 10);
        if (!Number.isInteger(index) || index < 0 || index >= HARDENED_OFFSET) {
            throw new Error(`Invalid path segment "${segment}" in ${path}`);
        }

        return hardened ? index + HARDENED_OFFSET : index;
    });
}

/**
 * RAILGUN engine compatible key derivation, as implemented in
 * `@railgun-community/engine` (`src/key-derivation/bip32.ts`).
 *
 * Unlike BIP-32 secp256k1, this is a SLIP-0010 style pure hash chain:
 *   master:  I = HMAC-SHA512(key = "babyjubjub seed", data = seed)
 *   child:   I = HMAC-SHA512(chainCode, 0x00 || chainKey || ser32(index))
 * with chainKey = I[0..32], chainCode = I[32..64] at each step.
 * Only hardened children are defined.
 */
function deriveRailgunEngineKey(seed: Uint8Array, indices: number[]): Uint8Array {
    let I = hmac(sha512, new TextEncoder().encode("babyjubjub seed"), seed);
    let chainKey = I.slice(0, 32);
    let chainCode = I.slice(32);

    for (const index of indices) {
        if (index < HARDENED_OFFSET) {
            throw new Error("RAILGUN engine derivation only supports hardened indices");
        }
        const data = new Uint8Array(1 + 32 + 4);
        data.set(chainKey, 1);
        new DataView(data.buffer).setUint32(33, index, false);
        I = hmac(sha512, chainCode, data);
        chainKey = I.slice(0, 32);
        chainCode = I.slice(32);
    }

    return chainKey;
}

/**
 * Simple mnemonic-based implementation of the host Keystore interface.
 */
export class MnemonicKeystore implements Keystore {
    readonly _brand = 'Keystore' as const;
    private mnemonic: string;

    constructor(mnemonic: string) {
        this.mnemonic = mnemonic;
    }

    static random(): MnemonicKeystore {
        const mnemonic = generateMnemonic(wordlist, 256);

        return new MnemonicKeystore(mnemonic);
    }

    async deriveAt(path: string): Promise<Hex.Hex> {
        const seed = mnemonicToSeedSync(this.mnemonic);
        const indices = parsePath(path);

        // RAILGUN paths (m/44'/1984'/… spending, m/420'/1984'/… viewing) must use
        // the engine's "babyjubjub seed" tree to stay compatible with the RAILGUN
        // ecosystem; BIP-32 secp256k1 would derive unrelated keys.
        if (indices.length >= 2 && indices[1] === RAILGUN_COIN_TYPE + HARDENED_OFFSET) {
            return Hex.fromBytes(deriveRailgunEngineKey(seed, indices));
        }

        const root = HDKey.fromMasterSeed(seed);
        const child = root.derive(path);

        if (!child.privateKey) throw new Error(`Could not derive private key at path ${path}`);

        return Hex.fromBytes(child.privateKey);
    }
}

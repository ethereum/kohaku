import { Keystore } from "./index";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist as english } from "@scure/bip39/wordlists/english.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { Hex } from "ox";
import { HARDENED_OFFSET, parseDerivationPath } from "./derivation-path";

/** RAILGUN registered coin type (SLIP-0044). */
const RAILGUN_COIN_TYPE = 1984;

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
    // A real private field: code holding the keystore cannot read the phrase.
    readonly #mnemonic: string;

    /**
     * @param mnemonic BIP-39 phrase; the words and checksum are checked against `options.wordlist` (English by default).
     */
    constructor(mnemonic: string, { wordlist = english }: { wordlist?: string[] } = {}) {
        if (typeof mnemonic !== "string" || !validateMnemonic(mnemonic, wordlist)) {
            throw new Error("Invalid mnemonic: expected a BIP-39 phrase with a valid checksum");
        }

        this.#mnemonic = mnemonic;
    }

    static random(): MnemonicKeystore {
        const mnemonic = generateMnemonic(english, 256);

        return new MnemonicKeystore(mnemonic);
    }

    async deriveAt(path: string): Promise<Hex.Hex> {
        const indices = parseDerivationPath(path);
        const seed = mnemonicToSeedSync(this.#mnemonic);

        // RAILGUN paths (m/44'/1984'/… spending, m/420'/1984'/… viewing) must use
        // the engine's "babyjubjub seed" tree to stay compatible with the RAILGUN
        // ecosystem; BIP-32 secp256k1 would derive unrelated keys.
        if (indices.length >= 2 && indices[1] === RAILGUN_COIN_TYPE + HARDENED_OFFSET) {
            return Hex.fromBytes(deriveRailgunEngineKey(seed, indices));
        }

        const child = indices.reduce((node, index) => node.deriveChild(index), HDKey.fromMasterSeed(seed));

        if (!child.privateKey) throw new Error(`Could not derive private key at path ${path}`);

        return Hex.fromBytes(child.privateKey);
    }
}

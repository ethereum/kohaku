import { Keystore } from "./index";
import { HDKey } from "@scure/bip32";
import { mnemonicToSeedSync, generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { Hex } from "ox";

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
        const root = HDKey.fromMasterSeed(seed);
        const child = root.derive(path);

        if (!child.privateKey) throw new Error(`Could not derive private key at path ${path}`);

        return Hex.fromBytes(child.privateKey);
    }
}
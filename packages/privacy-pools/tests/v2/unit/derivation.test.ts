import type { Keystore } from "@kohaku-eth/plugins";
import type { Hex } from "@0xbow-io/privacy-pools-v2-sdk";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { deriveKeystoreManager, ppv2SignerKeyPath } from "../../../src/v2/account/derivation";

const KEY_0 = `0x${"11".repeat(32)}` as Hex;
const KEY_1 = `0x${"22".repeat(32)}` as Hex;

/** Host keystore that returns a fixed key per path (deriveAt's determinism contract). */
function fixedKeystore(): Keystore {
    const byPath: Record<string, Hex> = {
        [ppv2SignerKeyPath(0)]: KEY_0,
        [ppv2SignerKeyPath(1)]: KEY_1,
    };

    return {
        deriveAt: async (path: string) => {
            const key = byPath[path];

            if (!key) throw new Error(`Unexpected derivation path: ${path}`);

            return key;
        },
    };
}

describe("deriveKeystoreManager", () => {
    it("uses the dedicated v2 path, distinct from the v1 family", () => {
        expect(ppv2SignerKeyPath(0)).toBe("m/28784'/2'/0'");
        expect(ppv2SignerKeyPath(0).startsWith("m/28784'/1'")).toBe(false);
    });

    it("derives byte-identical key material on repeat (FR-012)", async () => {
        const a = await deriveKeystoreManager({ keystore: fixedKeystore() });
        const b = await deriveKeystoreManager({ keystore: fixedKeystore() });

        expect(a.keystoreManager.getPrivateNullifyingKey()).toBe(
            b.keystoreManager.getPrivateNullifyingKey(),
        );
        expect(a.keystoreManager.getViewingKeyPair().publicKey).toBe(
            b.keystoreManager.getViewingKeyPair().publicKey,
        );
        expect(a.deriveConfig.signature).toBe(b.deriveConfig.signature);
    });

    it("binds signerAddress + addressHash correctly", async () => {
        const { signerAddress, deriveConfig } = await deriveKeystoreManager({
            keystore: fixedKeystore(),
        });

        expect(signerAddress).toBe(privateKeyToAccount(KEY_0).address);
        expect(deriveConfig.addressHash).toBe(keccak256(toBytes(signerAddress)));
        expect(deriveConfig.revocableKeyIndex).toBe("0x0");
    });

    it("different account indexes derive different keys", async () => {
        const a = await deriveKeystoreManager({ keystore: fixedKeystore(), accountIndex: 0 });
        const b = await deriveKeystoreManager({ keystore: fixedKeystore(), accountIndex: 1 });

        expect(a.keystoreManager.getPrivateNullifyingKey()).not.toBe(
            b.keystoreManager.getPrivateNullifyingKey(),
        );
    });

    it("honors a persisted revocableKeyIndex", async () => {
        const fresh = await deriveKeystoreManager({ keystore: fixedKeystore() });
        const rotated = await deriveKeystoreManager({
            keystore: fixedKeystore(),
            revocableKeyIndex: `0x1` as Hex,
        });

        expect(rotated.deriveConfig.revocableKeyIndex).toBe("0x1");
        // A different rotation index yields a different revocable key.
        expect(fresh.keystoreManager.getPrivateRevocableKey()).not.toBe(
            rotated.keystoreManager.getPrivateRevocableKey(),
        );
    });
});

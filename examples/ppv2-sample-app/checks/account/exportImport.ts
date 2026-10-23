/**
 * CHECK — backup/restore across devices (US7): exportAccount() from the
 * persistent session, importAccount() into a FRESH device (in-memory storage,
 * same live chain), then verify the restored balances match. The blob carries
 * notes + sync cursor but no key material — keys re-derive from the keystore.
 */
import type { Storage as PluginStorage } from "@kohaku-eth/plugins";
import { createLiveSession } from "../../src/live/session";
import { printHoldings, step } from "../util/print";

/** Fresh-device stand-in: an empty in-memory Host storage. */
function memoryStorage(): PluginStorage {
    const map = new Map<string, string>();

    return {
        _brand: "Storage",
        async set(key, value) {
            map.set(key, value);
        },
        async get(key) {
            return map.get(key) ?? null;
        },
    };
}

async function main(): Promise<void> {
    step("exportImport");

    // Device A: the persistent session.
    const deviceA = await createLiveSession({ requireFunds: false });
    const balancesA = await deviceA.plugin.balance(undefined);
    const spendableA = balancesA.find((b) => b.tag === "spendable")?.amount ?? 0n;
    const blob = await deviceA.plugin.exportAccount();

    console.log(`  exported account blob: ${blob.length} bytes (spendable=${spendableA} wei)`);

    if (blob.includes("privateKey") || blob.includes("mnemonic")) {
        throw new Error("Post-condition violated: export blob appears to carry key material.");
    }

    // Device B: fresh storage, same live chain; state must come from the blob.
    const deviceB = await createLiveSession({ requireFunds: false, storage: memoryStorage() });

    await deviceB.plugin.importAccount(blob);

    const balancesB = await deviceB.plugin.balance(undefined);
    const spendableB = balancesB.find((b) => b.tag === "spendable")?.amount ?? 0n;

    if (spendableB !== spendableA) {
        throw new Error(
            `Post-condition violated: restored spendable ${spendableB} != exported ${spendableA}.`,
        );
    }

    console.log("  restored on a fresh device:");
    await printHoldings(deviceB.plugin);
    console.log("✓ exportImport ok");
    process.exit(0);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

/**
 * CHECK — one-time on-chain keystore registration (US5).
 *
 * prepareRegisterKeystore() → the wallet signs+sends `setAuthPolicy` +
 * `setViewingKey` from `ownerAddress` (msg.sender-bound).
 * Post: isRegistered() flips to true. Idempotent: an already-registered
 * account passes without sending.
 */
import { createLiveSession } from "../../src/live/session";
import { etherscan, step } from "../util/print";

async function main(): Promise<void> {
    step("registerKeystore");

    const { plugin, wallet } = await createLiveSession();

    if (await plugin.isRegistered()) {
        console.log("✓ registerKeystore ok — already registered (idempotent)");
        process.exit(0);
    }

    const op = await plugin.prepareRegisterKeystore();

    console.log(`  sending ${op.txs.length} registration txs (setAuthPolicy, setViewingKey)…`);

    const hashes = await wallet.sendPublicOperation(op);

    for (const hash of hashes) console.log(`  ✓ ${etherscan(hash)}`);

    // Post: the on-chain registration is visible.
    if (!(await plugin.isRegistered())) {
        throw new Error("Post-condition violated: isRegistered() is still false after mining.");
    }

    console.log("✓ registerKeystore ok");
    process.exit(0);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

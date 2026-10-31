/**
 * CHECK — ragequit: unconditional public exit of one note (US6).
 *
 * prepareRageQuit(commitment) → the wallet signs+sends `PoolVault.ragequit`
 * from `ownerAddress` (the circuit forces the recipient to the note's owner).
 * Full note value, no ASP involvement — the escape hatch for notes whose
 * label the ASP never approved.
 *
 * Usage: pnpm check:ragequit [commitment]   (default: the smallest active note)
 */
import type { Hex } from "viem";
import { createLiveSession } from "../../src/live/session";
import { etherscan, printHoldings, step } from "../util/print";

async function main(): Promise<void> {
    const { plugin, wallet } = await createLiveSession();

    await plugin.sync();

    const active = ((await plugin.notes?.()) ?? []).sort((a, b) =>
        BigInt(a.value) < BigInt(b.value) ? -1 : 1,
    );
    const commitment = (process.argv[2] ?? active[0]?.commitment) as Hex | undefined;

    if (!commitment) {
        throw new Error("No active note to exit — shield first (pnpm check:shield).");
    }

    step(`ragequit ${commitment.slice(0, 10)}…`);
    console.log("  proving ragequit…");

    const op = await plugin.prepareRageQuit(commitment);
    const hashes = await wallet.sendPublicOperation(op);

    for (const hash of hashes) console.log(`  ✓ ragequit: ${etherscan(hash)}`);

    // Post: the note reconciles to exited and leaves the balance.
    await plugin.sync();

    const exited = ((await plugin.notes?.(undefined, true)) ?? []).find(
        (n) => n.commitment === commitment,
    );

    if (exited?.status !== "exited") {
        throw new Error(
            `Post-condition violated: note status is ${exited?.status ?? "missing"}, expected exited.`,
        );
    }

    await printHoldings(plugin);
    console.log("✓ ragequit ok");
    process.exit(0);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

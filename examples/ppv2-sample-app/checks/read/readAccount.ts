/**
 * CHECK — read path (US4): construction, live registration check, incremental
 * event discovery, balances/notes with live ASP label statuses. Sends nothing.
 */
import { createLiveSession } from "../../src/live/session";
import { printHoldings, step } from "../util/print";

async function main(): Promise<void> {
    step("readAccount (read-only)");

    const { plugin } = await createLiveSession({ requireFunds: false });

    console.log(`  registered: ${await plugin.isRegistered()}`);

    await plugin.sync();
    await printHoldings(plugin);

    console.log("✓ readAccount ok — nothing was sent");
    process.exit(0);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

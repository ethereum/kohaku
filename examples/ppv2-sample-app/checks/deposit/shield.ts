/**
 * CHECK — shield (public → private, US1) with a real Groth16 deposit proof.
 *
 * prepareShield(amount) → the wallet signs+sends the deposit through the
 * Entrypoint; the on-chain verifier accepts the proof or the tx reverts.
 * Post: sync discovers the new note (pending until the ASP approves it).
 *
 * Usage: pnpm check:shield [amountWei]   (default 1000)
 */
import { createLiveSession } from "../../src/live/session";
import { etherscan, printHoldings, step } from "../util/print";

async function main(): Promise<void> {
    const amount = BigInt(process.argv[2] ?? process.env["DEPOSIT_WEI"] ?? "1000");

    step(`shield ${amount} wei`);

    const { plugin, wallet } = await createLiveSession();
    const notesBefore = ((await plugin.notes?.(undefined, true)) ?? []).length;

    const op = await plugin.prepareShield({ asset: { __type: "native" }, amount });

    console.log("  proof ready; broadcasting deposit…");

    const hashes = await wallet.sendPublicOperation(op);

    for (const hash of hashes) console.log(`  ✓ deposit: ${etherscan(hash)}`);

    // Post: discovery finds the mined note from chain events.
    await plugin.sync();

    const notes = (await plugin.notes?.(undefined, true)) ?? [];
    const minted = notes.find((n) => BigInt(n.value) === amount && n.status !== "spent");

    if (notes.length <= notesBefore || !minted) {
        throw new Error("Post-condition violated: the deposited note was not discovered by sync.");
    }

    await printHoldings(plugin);
    console.log(
        `✓ shield ok — note ${minted.commitment.slice(0, 10)}… status=${minted.status} ` +
            `(spendable once the ASP approves its label)`,
    );
    process.exit(0);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

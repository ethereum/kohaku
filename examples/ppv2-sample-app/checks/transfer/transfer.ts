/**
 * CHECK — private cold-start transfer via the live relayer (US2).
 *
 * prepareTransfer(amount, to) → broadcast through the shared session: the
 * broadcast re-proves against the current ASP root, relays, and reconciles
 * spent/change notes; the cold-start payload carries the recipient's note
 * out-of-band. Needs an ASP-approved note covering amount + the relayer fee.
 *
 *
 * Usage: pnpm check:transfer [amountWei] [recipient]   (recipient defaults to owner)
 */
import { createPPv2Broadcaster, type PPv2AccountId } from "@kohaku-eth/privacy-pools";
import { createLiveSession } from "../../src/live/session";
import { etherscan, printHoldings, step } from "../util/print";

async function main(): Promise<void> {
    const amount = BigInt(process.argv[2] ?? process.env["TRANSFER_WEI"] ?? "1000000000000000");

    // Transfers are submitted by the relayer DIRECTLY from its EOA (verified
    // on-chain), so the proof context must bind that EOA as the processor —
    // unlike withdrawals, which route through the PrivacyPoolRelay contract.
    const { plugin, ownerAddress } = await createLiveSession({
        processorAddress: "0x4Ba5fF376865b370790A56276C63e7984DCFf1f7",
    });
    const recipient = (process.argv[3] ??
        process.env["TRANSFER_TO"] ??
        ownerAddress) as PPv2AccountId;

    step(`transfer ${amount} wei → ${recipient}`);

    // Warm-up pass: the staging relayer's fee commitments expire 60s after
    // quoting, and a cold prepare (tree-leaf scans + artifact load + proof)
    // exceeds that. Run prepare once to fill the log/artifact caches, then
    // prepare fresh and broadcast immediately so quote→relay fits the TTL.
    console.log("  warm-up prepare (fills leaf-scan + circuit caches)…");
    await plugin.prepareTransfer({ asset: { __type: "native" }, amount }, recipient);

    console.log("  hot prepare + relay…");

    const op = await plugin.prepareTransfer({ asset: { __type: "native" }, amount }, recipient);
    const result = await createPPv2Broadcaster(plugin).broadcast(op);

    console.log(`  ✓ relayed transfer: ${etherscan(result.txHash)}`);
    console.log("  cold-start payload for the recipient (deliver out-of-band):");
    console.log(`  ${result.coldStartPayload}`);

    // Post: the payload carries at least the recipient's note.
    const recipientNotes = JSON.parse(result.coldStartPayload) as Array<{ value: string }>;

    if (!recipientNotes.some((n) => BigInt(n.value) === amount)) {
        throw new Error("Post-condition violated: cold-start payload lacks the transferred note.");
    }

    await printHoldings(plugin);
    console.log("✓ transfer ok");
    process.exit(0);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

/**
 * CHECK — unshield to a public address via the live relayer (US3).
 *
 * prepareUnshield(amount, payout) → broadcast: the relayer executes the
 * withdrawal (payout routing is bound into the proof), the payout nets
 * `amount` to the recipient, and the mined relay marks the input spent with
 * the change note re-created under the same (approved) label.
 * Needs an ASP-approved note covering amount + the relayer fee.
 *
 * Usage: pnpm check:unshield [amountWei] [payoutAddress]   (payout defaults to owner)
 */
import { createPPv2Broadcaster } from "@kohaku-eth/privacy-pools";
import type { Address } from "viem";
import { createLiveSession } from "../../src/live/session";
import { etherscan, printHoldings, step } from "../util/print";

async function main(): Promise<void> {
    const amount = BigInt(process.argv[2] ?? process.env["WITHDRAW_WEI"] ?? "1000000000000000");

    // Withdrawals route through PrivacyPoolRelay — that contract is the
    // msg.sender of PoolVault.transact, so the proof must bind it as the
    // processor (transfers bind the relayer's EOA instead; see the transfer check).
    const { plugin, ownerAddress } = await createLiveSession({
        processorAddress: "0x762665Dc7aAeeA25DC1759AEBef1F61730497f6e",
    });
    const payout = (process.argv[3] ?? process.env["PAYOUT_ADDRESS"] ?? ownerAddress) as Address;

    step(`unshield ${amount} wei → ${payout}`);

    const spentBefore = ((await plugin.notes?.(undefined, true)) ?? []).filter(
        (n) => n.status === "spent",
    ).length;

    // Same warm-up rationale as the transfer check (60s fee-quote TTL).
    console.log("  warm-up prepare (fills leaf-scan + circuit caches)…");
    // The warm-up's only job is filling the leaf-scan/circuit caches; its own
    // quotes routinely expire mid-prepare (60s TTL vs a cold prove), which now
    // throws since the plugin enforces expiry — expected, swallow it.
    try {
        await plugin.prepareUnshield({ asset: { __type: "native" }, amount }, payout);
    } catch {
        /* caches are warm; the hot prepare below gets fresh quotes */
    }

    console.log("  hot prepare + relay…");

    const op = await plugin.prepareUnshield({ asset: { __type: "native" }, amount }, payout);
    const result = await createPPv2Broadcaster(plugin).broadcast(op);

    console.log(`  ✓ relayed withdrawal: ${etherscan(result.txHash)}`);

    // Post: mine-then-SPENT — the mined relay marked an input spent.
    const spentAfter = ((await plugin.notes?.(undefined, true)) ?? []).filter(
        (n) => n.status === "spent",
    ).length;

    if (spentAfter <= spentBefore) {
        throw new Error("Post-condition violated: no input note was marked spent by the relay.");
    }

    await printHoldings(plugin);
    console.log("✓ unshield ok");
    process.exit(0);
}

main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
});

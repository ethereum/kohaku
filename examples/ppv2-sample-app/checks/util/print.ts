/** Shared console helpers for the checks. */
import type { PPv2Instance } from "@kohaku-eth/privacy-pools";

export const etherscan = (hash: string): string => `https://sepolia.etherscan.io/tx/${hash}`;

export function step(title: string): void {
    console.log(`\n=== ${title} ===`);
}

/** Print pool balances and every note (incl. spent/exited) for the account. */
export async function printHoldings(plugin: PPv2Instance): Promise<void> {
    const balances = await plugin.balance(undefined);
    const spendable = balances.find((b) => b.tag === "spendable")?.amount ?? 0n;
    const unspendable = balances.find((b) => b.tag === "unspendable")?.amount ?? 0n;

    console.log(`  pool balance (native): spendable=${spendable} wei, unspendable=${unspendable} wei`);

    for (const note of (await plugin.notes?.(undefined, true)) ?? []) {
        console.log(
            `  note ${note.commitment.slice(0, 10)}… value=${note.value} status=${note.status} label=${note.labelState}`,
        );
    }
}

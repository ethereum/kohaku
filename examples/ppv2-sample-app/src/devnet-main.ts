/**
 * Privacy Pools v2 × Kohaku — sample wallet integration.
 *
 * Walks the full lifecycle a Kohaku-based wallet (e.g. the extension) drives
 * through the `@kohaku-eth/privacy-pools` v2 plugin:
 *
 *   1. host + plugin construction          createPPv2Plugin(host, params)
 *   2. one-time keystore registration      prepareRegisterKeystore → wallet sends
 *   3. shield (public → private)           prepareShield → wallet sends
 *   4. reads                               balance / notes (sync built in)
 *   5. private transfer via relayer        prepareTransfer → broadcaster
 *   6. unshield to a public address        prepareUnshield → broadcaster
 *   7. backup / restore                    exportAccount → importAccount
 *
 * Everything under `wallet/` is real integration code (imports only
 * `@kohaku-eth/*`). Everything under `devnet/` stands in for Sepolia + the
 * ASP + a relayer so the demo runs offline; swap it for real endpoints (and
 * drop `factories`) to run against a live deployment.
 */
import { MnemonicKeystore } from "@kohaku-eth/plugins";
import {
    createPPv2Broadcaster,
    createPPv2Plugin,
    type PPv2AccountId,
    type PPv2AssetAmount,
    type PPv2Instance,
} from "@kohaku-eth/privacy-pools";
import type { Address } from "viem";
import { Devnet } from "./devnet/devnet";
import { buildPluginParameters } from "./wallet/config";
import { createWalletHost, createWalletStorage } from "./wallet/host";
import { SampleWallet } from "./wallet/wallet";

const MNEMONIC = "test test test test test test test test test test test junk";
const TRANSFER_RECIPIENT = "0x00000000000000000000000000000000000000bb" as PPv2AccountId;
const WITHDRAW_PAYOUT = "0x00000000000000000000000000000000000000cc" as Address;

const native = (amount: bigint): PPv2AssetAmount => ({ asset: { __type: "native" }, amount });

function step(title: string): void {
    console.log(`\n=== ${title} ===`);
}

async function printHoldings(plugin: PPv2Instance): Promise<void> {
    const balances = await plugin.balance(undefined);
    const spendable = balances.find((b) => b.tag === "spendable")?.amount ?? 0n;
    const unspendable = balances.find((b) => b.tag === "unspendable")?.amount ?? 0n;

    console.log(`  balance (native): spendable=${spendable} wei, unspendable=${unspendable} wei`);

    for (const note of (await plugin.notes?.()) ?? []) {
        console.log(
            `  note ${note.commitment.slice(0, 10)}… value=${note.value} status=${note.status} label=${note.labelState}`,
        );
    }
}

async function main(): Promise<void> {
    step("1. Host + plugin construction");

    // The wallet derives its transacting account from the same keystore the
    // plugin derives protocol keys from — public operations MUST be sent from
    // this address (registration/ragequit bind to msg.sender).
    const keystore = new MnemonicKeystore(MNEMONIC);
    const bootstrapWallet = await SampleWallet.create(keystore, {
        sendTransaction: async () => {
            throw new Error("unreachable: address derivation only");
        },
    });
    const ownerAddress = bootstrapWallet.ownerAddress;

    // Devnet = in-process Sepolia + ASP + relayer. A real wallet replaces this
    // with an RPC provider and real service endpoints (no `factories`).
    const devnet = new Devnet({ keystore, ownerAddress });
    const wallet = await SampleWallet.create(keystore, devnet);
    const host = createWalletHost({ mnemonic: MNEMONIC, provider: devnet.provider() });
    const params = buildPluginParameters({ ownerAddress, factories: devnet.factories() });

    const plugin = await createPPv2Plugin(host, params);
    const broadcaster = createPPv2Broadcaster(plugin);

    console.log(`  plugin instance for owner ${await plugin.instanceId()}`);

    step("2. One-time keystore registration");
    console.log(`  registered before: ${await plugin.isRegistered()}`);

    // The plugin returns ready-to-sign calldata (setAuthPolicy + setViewingKey)
    // and never signs itself — the wallet signs and broadcasts both.
    const registration = await plugin.prepareRegisterKeystore();
    const registrationHashes = await wallet.sendPublicOperation(registration);

    console.log(`  wallet sent ${registrationHashes.length} registration txs`);
    console.log(`  registered after: ${await plugin.isRegistered()}`);

    step("3. Shield 1000 wei + 500 wei into the pool");

    for (const amount of [1000n, 500n]) {
        const shield = await plugin.prepareShield(native(amount));
        const [txHash] = await wallet.sendPublicOperation(shield);

        console.log(`  deposit of ${amount} wei mined: ${txHash?.slice(0, 18)}…`);
    }

    step("4. Read balance + notes (sync discovers the mined deposits)");
    await printHoldings(plugin);

    step("5. Private transfer: 700 wei to a cold-start recipient");

    // Quote-first: the plugin selects input notes covering amount + relayer
    // fee, builds the transact witness, and wraps the cheapest live quote.
    const transfer = await plugin.prepareTransfer(native(700n), TRANSFER_RECIPIENT);

    console.log(`  prepared ${transfer.kind}; broadcasting through the relayer…`);

    // Private operations go through the broadcaster (which shares the plugin's
    // session): re-prove with the quoted fee, relay, reconcile note state.
    const transferResult = await broadcaster.broadcast(transfer);

    console.log(`  relayed tx: ${transferResult.txHash.slice(0, 18)}…`);

    // Cold-start recipients get their note out-of-band (they have no viewing
    // key registered yet) — the wallet delivers this payload to them.
    const recipientNotes = JSON.parse(transferResult.coldStartPayload) as Array<{
        value: string;
    }>;

    console.log(
        `  cold-start payload for recipient: ${recipientNotes.length} note(s), values [${recipientNotes
            .map((n) => BigInt(n.value))
            .join(", ")}] wei`,
    );
    await printHoldings(plugin);

    step("6. Unshield: 300 wei to a public payout address");

    const withdrawal = await plugin.prepareUnshield(native(300n), WITHDRAW_PAYOUT);

    console.log(`  prepared ${withdrawal.kind}; broadcasting through the relayer…`);

    const withdrawalResult = await broadcaster.broadcast(withdrawal);

    console.log(
        `  relayed tx: ${withdrawalResult.txHash.slice(0, 18)}… (payout nets 300 wei to ${WITHDRAW_PAYOUT.slice(0, 10)}…)`,
    );
    await printHoldings(plugin);

    step("7. Backup + restore on a fresh device");

    // The export blob carries notes + sync cursor — never raw keys (those
    // always re-derive from the keystore).
    const blob = await plugin.exportAccount();

    console.log(`  exported account blob: ${blob.length} bytes`);

    // "New device": same seed phrase, empty storage, same chain. Plugin
    // construction re-derives keys and recognizes the on-chain registration.
    const freshHost = { ...host, storage: createWalletStorage() };
    const restored = await createPPv2Plugin(freshHost, params);

    await restored.importAccount(blob);
    console.log("  restored plugin from blob:");
    await printHoldings(restored);

    console.log("\nDone — full PPv2 lifecycle driven through the Kohaku plugin surface.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

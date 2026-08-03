/**
 * LIVE MODE — the wallet's signing path against real Sepolia: sign each
 * plugin-prepared `TxData` with the funded private key and broadcast through
 * the RPC, waiting for each receipt before the next (public operations are
 * ordered, e.g. approve → deposit). This is the piece the extension replaces
 * with its user-approved signer flow.
 */
import type { PPv2PublicOperation } from "@kohaku-eth/privacy-pools";
import type { Address, Chain, Hex, PublicClient, WalletClient } from "viem";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export class LiveWallet {
    readonly ownerAddress: Address;
    private readonly wallet: WalletClient;
    private readonly reads: PublicClient;

    constructor(privateKey: Hex, rpcUrl: string) {
        const account = privateKeyToAccount(privateKey);

        this.ownerAddress = account.address;
        // Explicit per-request timeout: a silently dead keepalive socket must
        // fail (and retry on a fresh connection) instead of hanging the run.
        const transport = http(rpcUrl, { timeout: 30_000, retryCount: 3 });

        this.wallet = createWalletClient({ account, chain: sepolia as Chain, transport });
        this.reads = createPublicClient({ chain: sepolia as Chain, transport });
    }

    async balance(): Promise<bigint> {
        return this.reads.getBalance({ address: this.ownerAddress });
    }

    /** Sign + broadcast a public operation from `ownerAddress`; returns tx hashes. */
    async sendPublicOperation(operation: PPv2PublicOperation): Promise<Hex[]> {
        const hashes: Hex[] = [];

        for (const tx of operation.txs) {
            console.log(`  broadcasting tx to ${tx.to.slice(0, 10)}… (value ${tx.value} wei)`);

            const hash = await this.wallet.sendTransaction({
                account: this.wallet.account!,
                chain: sepolia as Chain,
                to: tx.to as Address,
                data: tx.data as Hex,
                value: tx.value,
            });

            console.log(`  sent ${hash.slice(0, 18)}…, waiting for receipt`);

            const receipt = await this.reads.waitForTransactionReceipt({
                hash,
                timeout: 180_000,
            });

            if (receipt.status !== "success") {
                throw new Error(`transaction reverted: ${hash}`);
            }

            hashes.push(hash);
        }

        return hashes;
    }
}

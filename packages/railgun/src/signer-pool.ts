import { AssetAmount } from "@kohaku-eth/plugins";
import { JsPoiProvider, JsSigner, AssetId as RailgunAssetId } from "./pkg/railgun_rs";

export interface DrainEntry {
    signer: JsSigner;
    asset: RailgunAssetId;
    amount: bigint;
}

/**
 * Helper class to manage multiple signers for a single user. Can be be used to 
 * aggregate UTXOs across multiple keys when preparing a transfer or unshield.
 */
export class SignerPool {
    private signers: JsSigner[] = [];

    constructor(primary: JsSigner) {
        this.signers.push(primary);
    }

    //? Safe to assume at least one signer exists since constructor requires it.
    get primary(): JsSigner { return this.signers[0]!; }
    get all(): JsSigner[] { return [...this.signers]; }

    add(signer: JsSigner) {
        this.signers.push(signer);
    }

    /** Returns spending keys for serialization. */
    internalKeys(): { spendingKey: `0x${string}`, viewingKey: `0x${string}` }[] {
        return this.signers.slice(1).map(s => ({
            spendingKey: s.spendingKey,
            viewingKey: s.viewingKey,
        }));
    }

    /** Register all signers with a provider. */
    registerAll(provider: JsPoiProvider) {
        for (const s of this.signers) {
            provider.register(s);
        }
    }

    /**
     * Drain UTXOs across all signers to satisfy requested token amounts.
     * Returns a list of (signer, asset, amount) contributions.
     * Throws if any token can't be fully covered.
     */
    async drain(
        provider: JsPoiProvider,
        listKey: string,
        tokens: AssetAmount[],
    ): Promise<DrainEntry[]> {
        const remaining = new Map(tokens.map(t => [t.asset.contract, t.amount]));
        const entries: DrainEntry[] = [];

        for (const signer of this.signers) {
            const balance = await provider.balance(signer.address, listKey);
            for (const b of balance) {
                if (b.poiStatus !== "Valid" || b.balance <= 0n) continue;
                if (b.assetId.type !== "Erc20") continue;

                const need = remaining.get(b.assetId.value as `0x${string}`);
                if (!need || need <= 0n) continue;

                const take = need < b.balance ? need : b.balance;
                entries.push({ signer, asset: b.assetId, amount: take });
                remaining.set(b.assetId.value as `0x${string}`, need - take);
            }
        }

        for (const [asset, amt] of remaining) {
            if (amt > 0n) throw new Error(`Insufficient balance for ${asset}`);
        }

        return entries;
    }
}


import type { AssetAmount, ERC20AssetId } from "@kohaku-eth/plugins";
import type { RailgunSigner, AssetId, RailgunProvider } from "./lib";

export interface DrainEntry {
    signer: RailgunSigner;
    asset: AssetId;
    amount: bigint;
}

/**
 * Helper class to manage multiple signers for a single user. Can be be used to 
 * aggregate UTXOs across multiple keys when preparing a transfer or unshield.
 */
export class SignerPool {
    private signers: RailgunSigner[] = [];

    constructor(primary: RailgunSigner) {
        this.signers.push(primary);
    }

    //? Safe to assume at least one signer exists since constructor requires it.
    get primary(): RailgunSigner { return this.signers[0]!; }
    get all(): RailgunSigner[] { return [...this.signers]; }

    add(signer: RailgunSigner) {
        this.signers.push(signer);
    }

    /**
     * Drain UTXOs across all signers to satisfy requested token amounts.
     * Returns a list of (signer, asset, amount) contributions.
     * Throws if any token can't be fully covered.
     */
    async drain(
        provider: RailgunProvider,
        tokens: AssetAmount<ERC20AssetId>[],
    ): Promise<DrainEntry[]> {
        const remaining = new Map(tokens.map(t => [t.asset.contract, t.amount]));
        const entries: DrainEntry[] = [];

        for (const signer of this.signers) {
            const balances = await provider.balance(signer.address);

            for (const b of balances) {
                const asset = b[0];
                const balance = b[1];
                if (balance <= 0n) continue;
                if (asset.type !== "Erc20") continue;

                const need = remaining.get(asset.value);
                if (!need || need <= 0n) continue;

                const take = need < balance ? need : balance;
                entries.push({ signer, asset: asset, amount: take });
                remaining.set(asset.value, need - take);
            }
        }

        for (const [asset, amt] of remaining) {
            if (amt > 0n) throw new Error(`Insufficient balance for ${asset}`);
        }

        return entries;
    }
}

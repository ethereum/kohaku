import type { CreatePluginFn, Host } from "@kohaku-eth/plugins";
import type { INoteManager, PoolSession } from "@privacy-pools-v2/sdk";
import { deriveKeystoreManager } from "./account/derivation";
import { NotImplementedError } from "./interfaces/errors";
import type {
    PPv2AccountId,
    PPv2AssetAmount,
    PPv2Instance,
    PPv2PluginParameters,
} from "./interfaces/plugin.interface";
import type {
    PPv2Note,
    PPv2PrivateOperation,
    PPv2PublicOperation,
} from "./interfaces/operations.interface";
import type { PPv2AssetId } from "./mapping/assets";
import { assetToTokenId, hexToAmount, tokenIdToAsset } from "./mapping/assets";
import { isExcluded, labelStateFor, statusLabel, statusToReport } from "./mapping/status";
import { assemblePoolSession } from "./session";

/** Constructor dependencies for {@link PPv2Plugin}; assembled by {@link createPPv2Plugin}. */
type PPv2PluginDeps = {
    session: PoolSession;
    noteManager: INoteManager;
    params: PPv2PluginParameters;
};

/**
 * The Privacy Pools v2 plugin. Reads flow through the plugin-owned
 * {@link INoteManager}; state-changing flows return operations for the wallet /
 * broadcaster and never sign a transaction (INV-1). Every state-reading entry
 * point syncs incrementally first (FR-005).
 */
export class PPv2Plugin implements PPv2Instance {
    private readonly session: PoolSession;
    private readonly noteManager: INoteManager;
    private readonly params: PPv2PluginParameters;

    constructor(deps: PPv2PluginDeps) {
        this.session = deps.session;
        this.noteManager = deps.noteManager;
        this.params = deps.params;
    }

    /** The wallet account that sends public operations (FR-014). */
    async instanceId(): Promise<PPv2AccountId> {
        return this.params.ownerAddress as PPv2AccountId;
    }

    // ---- extras -----------------------------------------------------------------

    /** Discover new notes from chain and purge never-broadcast phantoms (FR-005/032). */
    async sync(): Promise<void> {
        await this.session.discoverNotes();
        await this.session.purgePhantomNotes();
    }

    async isRegistered(): Promise<boolean> {
        return this.session.isKeystoreRegistered();
    }

    // ---- reads ------------------------------------------------------------------

    /** Per-asset spendable/unspendable balances; never overstates (INV-4, US4). */
    async balance(assets: Array<PPv2AssetId> | undefined): Promise<Array<PPv2AssetAmount>> {
        await this.sync();

        const totals = new Map<string, { asset: PPv2AssetId; spendable: bigint; unspendable: bigint }>();

        for (const note of this.noteManager.getNotes()) {
            const report = statusToReport(note.status);

            if (report === "excluded") continue;

            const key = note.tokenId.toLowerCase();
            let entry = totals.get(key);

            if (!entry) {
                entry = { asset: tokenIdToAsset(note.tokenId), spendable: 0n, unspendable: 0n };
                totals.set(key, entry);
            }

            const value = hexToAmount(note.value);

            if (report === "spendable") entry.spendable += value;
            else entry.unspendable += value;
        }

        const wanted = assets
            ? new Set(assets.map((a) => assetToTokenId(a).toLowerCase()))
            : undefined;

        const out: PPv2AssetAmount[] = [];

        for (const entry of totals.values()) {
            if (wanted && !wanted.has(assetToTokenId(entry.asset).toLowerCase())) continue;

            out.push({ asset: entry.asset, amount: entry.spendable, tag: "spendable" });
            out.push({ asset: entry.asset, amount: entry.unspendable, tag: "unspendable" });
        }

        return out;
    }

    /** Per-note detail; spent/exited excluded unless `includeSpent` (US4). */
    async notes(
        assets?: Array<PPv2AssetId>,
        includeSpent?: boolean,
    ): Promise<Array<PPv2Note>> {
        await this.sync();

        const wanted = assets
            ? new Set(assets.map((a) => assetToTokenId(a).toLowerCase()))
            : undefined;

        return this.noteManager
            .getNotes()
            .filter((note) => (includeSpent ? true : !isExcluded(note.status)))
            .filter((note) => !wanted || wanted.has(note.tokenId.toLowerCase()))
            .map((note) => ({
                commitment: note.commitment,
                asset: tokenIdToAsset(note.tokenId),
                value: hexToAmount(note.value),
                status: statusLabel(note.status),
                labelState: labelStateFor(note.status),
            }));
    }

    // ---- verbs (pending their user-story tasks) --------------------------------
    // NOTE: parameters are intentionally omitted from these throwing stubs (TS
    // method bivariance keeps them assignable to PPv2Instance); the real
    // signatures are restored as each verb is implemented in its US task.

    async prepareShield(): Promise<PPv2PublicOperation> {
        throw new NotImplementedError("prepareShield", "US1/T033");
    }

    async prepareTransfer(): Promise<PPv2PrivateOperation> {
        throw new NotImplementedError("prepareTransfer", "US2/T038");
    }

    async prepareUnshield(): Promise<PPv2PrivateOperation> {
        throw new NotImplementedError("prepareUnshield", "US3/T043");
    }

    async prepareRegisterKeystore(): Promise<PPv2PublicOperation> {
        throw new NotImplementedError("prepareRegisterKeystore", "US5/T053");
    }

    async prepareRageQuit(): Promise<PPv2PublicOperation> {
        throw new NotImplementedError("prepareRageQuit", "US6/T057");
    }

    async exportAccount(): Promise<string> {
        throw new NotImplementedError("exportAccount", "US7/T061");
    }

    async importAccount(): Promise<void> {
        throw new NotImplementedError("importAccount", "US7/T061");
    }
}

/**
 * Construct one Privacy Pools v2 plugin instance: derive keys from the host
 * keystore, assemble the SDK session (owning the note manager), and wrap them in
 * {@link PPv2Plugin} (FR-001/003).
 */
export const createPPv2Plugin: CreatePluginFn<PPv2Instance, PPv2PluginParameters> = async (
    host: Host,
    params: PPv2PluginParameters,
): Promise<PPv2Instance> => {
    // TODO(T062): read a persisted revocableKeyIndex and/or run
    // session.discoverRevocableKeyIndex for fresh-device recovery. Fresh accounts
    // and the common case derive at index 0.
    const { keystoreManager } = await deriveKeystoreManager({
        keystore: host.keystore,
        accountIndex: params.accountIndex,
    });

    const { session, noteManager } = await assemblePoolSession(host, params, keystoreManager);

    return new PPv2Plugin({ session, noteManager, params });
};

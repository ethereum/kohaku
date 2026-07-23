/* eslint-disable max-lines */
// The plugin class holds every verb + read; matches the v1 `PrivacyPoolsV1Protocol`
// precedent. If it grows unwieldy, extract verbs into an `operations/` module.
import { InsufficientBalanceError, InvalidAddressError } from "@kohaku-eth/plugins";
import type { CreatePluginFn, Host, UnshieldOptions } from "@kohaku-eth/plugins";
import { isAddress } from "viem";
import type { TxData } from "@kohaku-eth/provider";
import type { Address as OxAddress } from "ox/Address";
import { type Address, type Hex, type INoteManager, type PoolSession } from "@0xbow-io/privacy-pools-v2-sdk";
import { deriveKeystoreManager } from "./account/derivation";
import { persistRevocableKeyIndex, readRevocableKeyIndex } from "./account/keystore-record";
import { KohakuStorageService } from "./adapters/storage.adapter";
import {
    AccountImportMismatchError,
    AlreadyRegisteredError,
    InsufficientFundsError,
    InvalidOperationError,
    mapSdkError,
    NotImplementedError,
    NotRegisteredError,
    RelayerUnavailableError,
} from "./interfaces/errors";
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
import { isFeeCommitmentLive } from "./internal/quotes";
import { registerSession } from "./internal/session-registry";
import type { PPv2AssetId } from "./mapping/assets";
import { amountToHex, assetToTokenId, hexToAmount, tokenIdToAsset } from "./mapping/assets";
import { isExcluded, isSpendable, labelStateFor, statusLabel, statusToReport } from "./mapping/status";
import { selectInputNotes } from "./selection/note-selection";
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

    /** Wire the factory-owned dependencies (session, note manager, parameters). */
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

    /**
     * Full sync: discover note state from chain events, then purge phantom notes
     * (reorg-orphaned records, INV-9). Purge lives here rather than in the
     * read-path sync so reads stay cheap (purge does one chain read per pending
     * note); per the SDK contract, call this when no transaction is in flight.
     */
    async sync(): Promise<void> {
        try {
            await this.reconcile();
            await this.session.purgePhantomNotes();
        } catch (err) {
            throw mapSdkError(err);
        }
    }

    /**
     * Read-path sync (FR-005): discover notes from chain events. Deposits appear
     * here once their transaction mines — the plugin persists nothing at prepare
     * time (C16): storage is a cache of chain state (INV-2), and pre-mine
     * visibility of an in-flight deposit is the wallet's responsibility (it is
     * the one that signed and broadcast the transaction).
     */
    private async reconcile(): Promise<void> {
        try {
            await this.session.discoverNotes();
        } catch (err) {
            // No raw SDK exception may cross the plugin boundary (FR-060) — reads
            // (balance/notes) and prepares all funnel through here.
            throw mapSdkError(err);
        }
    }

    /** Whether the account's keystore is registered on-chain (FR-026, INV-8). */
    async isRegistered(): Promise<boolean> {
        try {
            return await this.session.isKeystoreRegistered();
        } catch (err) {
            throw mapSdkError(err);
        }
    }

    // ---- reads ------------------------------------------------------------------

    /** Per-asset spendable/unspendable balances; never overstates (INV-4, US4). */
    async balance(assets: Array<PPv2AssetId> | undefined): Promise<Array<PPv2AssetAmount>> {
        await this.reconcile();

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
        await this.reconcile();

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

    /**
     * Shield a public balance into the pool (US1, FR-020). Maps to
     * `PoolSession.prepareDeposit` and returns ready-to-sign `TxData[]`: an ERC20
     * approve (only when the SDK reports one needed) followed by the deposit call,
     * with `msgValue` set for native ETH. The plugin sends nothing (INV-1).
     */
    async prepareShield(asset: PPv2AssetAmount, to?: PPv2AccountId): Promise<PPv2PublicOperation> {
        if (to !== undefined) {
            // deposit-for (shield to another recipient) is a follow-up; US1 is self-shield.
            throw new NotImplementedError("prepareShield(to) deposit-for", "US1 follow-up");
        }

        // No reconcile(): deposit calldata doesn't depend on note state, so a
        // network sync here would be a wasted round-trip.
        try {
            const result = await this.session.prepareDeposit({
                tokenId: assetToTokenId(asset.asset),
                value: amountToHex(asset.amount),
            });

            const txs: TxData[] = [];

            if (result.approvalTx) {
                txs.push({
                    to: result.approvalTx.to,
                    data: result.approvalTx.data,
                    value: BigInt(result.approvalTx.value),
                });
            }

            txs.push({ to: result.to, data: result.callData, value: BigInt(result.msgValue) });

            // Nothing is persisted at prepare time (C16): the note becomes visible
            // through sync discovery once the deposit mines (INV-2 — storage is a
            // cache of chain state). The wallet owns pre-mine visibility of the
            // transaction it signs and broadcasts.
            return { __type: "publicOperation", txs };
        } catch (err) {
            throw mapSdkError(err);
        }
    }

    /**
     * Private cold-start transfer to any EVM address (US2, FR-021). Quote-first: the
     * plugin fetches relayer quotes, picks the cheapest live one, selects input notes
     * covering amount + that fee (single label, INV-5), then maps to
     * `PoolSession.prepareColdStartTransfer` and wraps the matching relay option. The
     * proof/relay run inside the shared session at broadcast; the plugin never signs
     * (INV-1). Requires registration (FR-026, INV-8).
     */
    async prepareTransfer(asset: PPv2AssetAmount, to: PPv2AccountId): Promise<PPv2PrivateOperation> {
        // Fail fast with a typed error before any network work — the SDK would
        // otherwise surface a malformed recipient deep inside proving.
        if (!isAddress(to, { strict: false })) throw new InvalidAddressError(to);

        await this.reconcile();

        if (!(await this.isRegistered())) throw new NotRegisteredError();

        try {
            const tokenId = assetToTokenId(asset.asset);

            // Fail before selection when the whole spendable balance can't cover
            // the amount — the same cross-label pre-check as prepareUnshield, so
            // both verbs report plain insufficiency identically (US2/US3 AC-3).
            const spendable = this.spendableFor(tokenId);

            if (asset.amount > spendable) {
                throw new InsufficientBalanceError(asset.asset, asset.amount, spendable);
            }

            // Select the largest notes of a single label covering the amount (INV-5).
            // No separate quote fetch: prepareColdStartTransfer generates the relayer
            // quotes itself, and the fee is verified against the resulting change below.
            const selected = selectInputNotes({
                notes: this.noteManager.getNotes(),
                tokenId,
                required: asset.amount,
            });

            const result = await this.session.prepareColdStartTransfer({
                inputCommitments: selected.commitments,
                amount: amountToHex(asset.amount),
                tokenId,
                recipientEvmAddress: to as unknown as Address,
            });

            // Pick the cheapest live relay option whose fee fits the change. If a
            // relayer replied but none is live, that's a relayer/liveness problem;
            // if live options exist but none fits the change, the label covered the
            // amount but not amount + fee — a funds shortfall, not fragmentation.
            const changeMax = selected.total - asset.amount;
            const live = result.relayOptions.filter((o) =>
                isFeeCommitmentLive(o.selectedQuote.quote.feeCommitment.expiration),
            );

            if (live.length === 0) {
                throw new RelayerUnavailableError("No live relayer quote available for the transfer.");
            }

            const affordable = live.filter(
                (o) => BigInt(o.selectedQuote.quote.feeAmount) <= changeMax,
            );

            if (affordable.length === 0) {
                throw new InsufficientFundsError(
                    `Selected notes cover the ${asset.amount} transfer but not the relayer fee ` +
                        `(label spendable: ${selected.total}).`,
                );
            }

            const relayParams = affordable.reduce((a, b) =>
                BigInt(a.selectedQuote.quote.feeAmount) <= BigInt(b.selectedQuote.quote.feeAmount)
                    ? a
                    : b,
            );

            // Quote sanity before any proving: a commitment quoted for another
            // asset can only produce an on-chain rejection later (FR-052).
            assertQuoteAsset(relayParams.selectedQuote.quote.feeCommitment.asset, tokenId);

            return {
                __type: "privateOperation",
                kind: "transfer",
                chainId: this.params.chainId,
                relayParams,
            };
        } catch (err) {
            throw mapSdkError(err);
        }
    }

    /**
     * Withdraw to a public address via a relayer (US3, FR-022). Mirrors the
     * transfer flow: select the 4 largest notes of one label covering the amount,
     * map to `PoolSession.prepareWithdraw` (the SDK fetches its own quotes, bound
     * to recipient + amount), then pick the cheapest live relayer option whose fee
     * fits (`amountSent = amount + fee` is drawn from the pool; the recipient
     * receives `amount`). Payout routing is bound into the proof (INV-7); relaying
     * happens in the shared session at broadcast (INV-1).
     */
    async prepareUnshield(
        asset: PPv2AssetAmount,
        to: OxAddress,
        options?: UnshieldOptions,
    ): Promise<PPv2PrivateOperation> {
        if (options?.tailCalls) {
            // The relayer executes the withdrawal; appended wallet calls can't ride it.
            throw new NotImplementedError("prepareUnshield tailCalls", "unsupported by relayer path");
        }

        if (!isAddress(to, { strict: false })) throw new InvalidAddressError(to);

        await this.reconcile();

        if (!(await this.isRegistered())) throw new NotRegisteredError();

        try {
            const tokenId = assetToTokenId(asset.asset);

            // Fail before any proving when the whole spendable balance can't cover
            // the amount (US3 AC-3).
            const spendable = this.spendableFor(tokenId);

            if (asset.amount > spendable) {
                throw new InsufficientBalanceError(asset.asset, asset.amount, spendable);
            }

            const selected = selectInputNotes({
                notes: this.noteManager.getNotes(),
                tokenId,
                required: asset.amount,
            });

            const result = await this.session.prepareWithdraw({
                inputCommitments: selected.commitments,
                amount: amountToHex(asset.amount),
                tokenId,
                recipientAddress: to as unknown as Address,
            });

            // Cheapest live relayer option whose fee fits: the pool releases
            // amount + fee, so the selected inputs must cover both.
            const feeMax = selected.total - asset.amount;
            const live = result.relayerOptions.filter((o) =>
                isFeeCommitmentLive(o.selectedQuote.quote.feeCommitment.expiration),
            );

            if (live.length === 0) {
                throw new RelayerUnavailableError(
                    "No live relayer quote available for the withdrawal.",
                );
            }

            const affordable = live.filter(
                (o) => BigInt(o.selectedQuote.quote.feeAmount) <= feeMax,
            );

            if (affordable.length === 0) {
                // The label covered the amount but not amount + fee — a funds
                // shortfall, not fragmentation.
                throw new InsufficientFundsError(
                    `Selected notes cover the ${asset.amount} withdrawal but not the relayer fee ` +
                        `(label spendable: ${selected.total}).`,
                );
            }

            const relayParams = affordable.reduce((a, b) =>
                BigInt(a.selectedQuote.quote.feeAmount) <= BigInt(b.selectedQuote.quote.feeAmount)
                    ? a
                    : b,
            );

            assertQuoteAsset(relayParams.selectedQuote.quote.feeCommitment.asset, tokenId);

            return {
                __type: "privateOperation",
                kind: "withdrawal",
                chainId: this.params.chainId,
                relayParams,
            };
        } catch (err) {
            throw mapSdkError(err);
        }
    }

    /** Total spendable (ACTIVE) value for a token id, from the plugin-owned manager. */
    private spendableFor(tokenId: Address): bigint {
        return this.noteManager
            .getNotes()
            .filter(
                (note) =>
                    isSpendable(note.status) &&
                    note.tokenId.toLowerCase() === tokenId.toLowerCase(),
            )
            .reduce((sum, note) => sum + hexToAmount(note.value), 0n);
    }

    /**
     * One-time on-chain keystore registration (US5, FR-025). Returns a public
     * operation with `Keystore.setAuthPolicy` followed by `setViewingKey` (the
     * published viewing key makes future incoming transfers discoverable). The
     * wallet MUST send both from `ownerAddress` — the calls bind to `msg.sender`
     * (FR-014, DEP-6).
     */
    async prepareRegisterKeystore(): Promise<PPv2PublicOperation> {
        try {
            const result = await this.session.prepareRegisterKeystore();

            if (result.alreadyRegistered) throw new AlreadyRegisteredError();

            const txs: TxData[] = [];

            for (const call of [result.keystoreCalldata, result.viewingKeyCalldata]) {
                if (call) txs.push({ to: call.to, data: call.data, value: BigInt(call.value) });
            }

            return { __type: "publicOperation", txs };
        } catch (err) {
            throw mapSdkError(err);
        }
    }

    /**
     * Public escape hatch for a note whose label was revoked (US6, FR-025).
     * Returns a public operation encoding `PoolVault.ragequit`; the circuit forces
     * the recipient to the note's owner, and the wallet MUST send it from
     * `ownerAddress` (`msg.sender`-bound, DEP-6). Full note value, no ASP proof —
     * deliberately NO registration guard (guaranteed exit is unconditional). The
     * note flips to `exited` when sync observes the ragequit event.
     */
    async prepareRageQuit(commitment: Hex): Promise<PPv2PublicOperation> {
        await this.reconcile();

        try {
            const result = await this.session.prepareRageQuit({ commitment });

            return {
                __type: "publicOperation",
                txs: [{ to: result.to, data: result.callData, value: 0n }],
            };
        } catch (err) {
            throw mapSdkError(err);
        }
    }

    /**
     * Serialize the full account state (notes + sync cursor + payment requests)
     * into one portable blob (US7, FR-033). The SDK envelope is stamped with
     * owner + chainId and contains NO raw key material (INV-3) — keys always
     * re-derive from the keystore (INV-2).
     */
    async exportAccount(): Promise<string> {
        try {
            return JSON.stringify(await this.session.exportAccount());
        } catch (err) {
            throw mapSdkError(err);
        }
    }

    /**
     * Restore state from an {@link exportAccount} blob. The SDK rejects an
     * envelope whose owner or chain differs from this instance (FR-033 →
     * `AccountImportMismatchError`); subsequent syncs continue incrementally.
     */
    async importAccount(blob: string): Promise<void> {
        let parsed: unknown;

        try {
            parsed = JSON.parse(blob);
        } catch {
            throw new AccountImportMismatchError();
        }

        try {
            await this.session.importAccount(parsed as never);
        } catch (err) {
            throw mapSdkError(err);
        }
    }
}

/**
 * The chosen quote's fee commitment must be denominated in the transacted
 * asset — the SDK only enforces this at relay time, AFTER proving.
 */
function assertQuoteAsset(quotedAsset: string, tokenId: Address): void {
    if (quotedAsset.toLowerCase() !== tokenId.toLowerCase()) {
        throw new InvalidOperationError(
            `Relayer quote is for asset ${quotedAsset}, not the transacted ${tokenId}.`,
        );
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
    // Rotation-index recovery (FR-013, T062): derive with the persisted index when
    // one exists. On a fresh device (no record) with an on-chain registration, run
    // the SDK's gap scan once and, if the account rotated, re-derive + re-assemble
    // at the discovered index. Unregistered accounts cannot have rotated — skip the
    // scan and stay at index 0 without persisting (so a later restore still scans).
    const recordStorage = new KohakuStorageService(host.storage, params.storeKey);
    const persistedIndex = await readRevocableKeyIndex(
        recordStorage,
        params.chainId,
        params.ownerAddress,
    );

    // The factory is a public boundary like the instance methods: session assembly,
    // registration checks, and the gap scan all call into the SDK, so their
    // failures are normalized through mapSdkError (FR-060). Already-typed plugin
    // errors (e.g. storage corruption) pass through unchanged.
    let assembled;

    try {
        let derived = await deriveKeystoreManager({
            keystore: host.keystore,
            accountIndex: params.accountIndex,
            ...(persistedIndex ? { revocableKeyIndex: persistedIndex } : {}),
        });

        assembled = await assemblePoolSession(host, params, derived.keystoreManager);

        if (persistedIndex === null && (await assembled.session.isKeystoreRegistered())) {
            const discovered = await assembled.session.discoverRevocableKeyIndex(
                {
                    signature: derived.deriveConfig.signature,
                    signerAddress: derived.deriveConfig.signerAddress,
                    addressHash: derived.deriveConfig.addressHash,
                },
                params.revocableKeyGapLimit,
            );

            if (BigInt(discovered) !== 0n) {
                derived = await deriveKeystoreManager({
                    keystore: host.keystore,
                    accountIndex: params.accountIndex,
                    revocableKeyIndex: discovered,
                });
                assembled = await assemblePoolSession(host, params, derived.keystoreManager);
            }

            await persistRevocableKeyIndex(
                recordStorage,
                params.chainId,
                params.ownerAddress,
                discovered,
            );
        }
    } catch (err) {
        throw mapSdkError(err);
    }

    const { session, noteManager } = assembled;
    const plugin = new PPv2Plugin({ session, noteManager, params });

    // Link instance → session so createPPv2Broadcaster shares it (FR-053) without
    // leaking the SDK session on the public type.
    registerSession(plugin, session);

    return plugin;
};

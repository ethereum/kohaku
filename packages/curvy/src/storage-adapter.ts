import type { StorageInterface } from "@0xcurvy/curvy-sdk";
import { StorageError } from "@0xcurvy/curvy-sdk";
import type { NETWORK_ENVIRONMENT_VALUES } from "@0xcurvy/curvy-sdk";
import type { CurvyWalletData, PriceData } from "@0xcurvy/curvy-sdk";
import type { BalanceEntry, CurrencyMetadata, TotalBalance } from "@0xcurvy/curvy-sdk";
import type { CurvyWallet } from "@0xcurvy/curvy-sdk";
import type { Storage } from "@kohaku-eth/plugins";

// Storage keys. All state is namespaced under "curvy:" to avoid collisions.
const KEYS = {
    wallets: "curvy:wallets",
    currencies: "curvy:currencies",
    prices: "curvy:prices",
    balances: "curvy:balances",
    totals: "curvy:totals",
} as const;

function toJSON(value: unknown): string {
    return JSON.stringify(value, (_key, v) =>
        typeof v === "bigint" ? { __bigint__: v.toString() } : v,
    );
}

function fromJSON<T>(json: string | null): T {
    if (json === null) return [] as unknown as T;
    return JSON.parse(json, (_key, v) =>
        v !== null && typeof v === "object" && "__bigint__" in v ? BigInt(v.__bigint__) : v,
    ) as T;
}

/**
 * Adapts Kohaku's `Host.Storage` (synchronous string key-value store) to the
 * Curvy SDK's `StorageInterface` (async, domain-specific methods).
 *
 * State is held in in-memory Maps for fast access and written through to
 * `Host.Storage` after every mutation. On construction the adapter loads any
 * previously persisted state so that balance entries and wallet data survive
 * across plugin creations within the same wallet session.
 *
 * Key material is NEVER written to storage — it is re-derived from the
 * keystore on each plugin creation.
 */
export class HostStorageAdapter implements StorageInterface {
    readonly #store: Storage;
    readonly #wallets = new Map<string, CurvyWalletData>();
    readonly #currencies = new Map<string, CurrencyMetadata>();
    readonly #prices = new Map<string, PriceData>();
    readonly #balances = new Map<string, BalanceEntry>();
    readonly #totals = new Map<string, TotalBalance>();

    constructor(store: Storage) {
        this.#store = store;
        this.#load();
    }

    // ── Load / save helpers ───────────────────────────────────────────────

    #load(): void {
        for (const [map, key] of [
            [this.#wallets, KEYS.wallets],
            [this.#currencies, KEYS.currencies],
            [this.#prices, KEYS.prices],
            [this.#balances, KEYS.balances],
            [this.#totals, KEYS.totals],
        ] as const) {
            const entries = fromJSON<[string, unknown][]>(this.#store.get(key));
            if (Array.isArray(entries)) {
                for (const [k, v] of entries) {
                    (map as Map<string, unknown>).set(k, v);
                }
            }
        }
    }

    #saveWallets(): void {
        this.#store.set(KEYS.wallets, toJSON([...this.#wallets.entries()]));
    }

    #saveCurrencies(): void {
        this.#store.set(KEYS.currencies, toJSON([...this.#currencies.entries()]));
    }

    #savePrices(): void {
        this.#store.set(KEYS.prices, toJSON([...this.#prices.entries()]));
    }

    #saveBalances(): void {
        this.#store.set(KEYS.balances, toJSON([...this.#balances.entries()]));
    }

    #saveTotals(): void {
        this.#store.set(KEYS.totals, toJSON([...this.#totals.entries()]));
    }

    // ── Key helpers (mirrors MapStorage) ─────────────────────────────────

    #balanceKey(e: { walletId: string; id: string; currencyAddress: string; networkSlug: string }): string {
        return `${e.walletId}-${e.id}-${e.currencyAddress}-${e.networkSlug}`;
    }

    #totalKey(e: { walletId: string; currencyAddress: string; networkSlug: string }): string {
        return `${e.walletId}-${e.currencyAddress}-${e.networkSlug}`;
    }

    #currencyKey(e: { address: string; networkSlug: string }): string {
        return `${e.address}-${e.networkSlug}`;
    }

    // ── StorageInterface ──────────────────────────────────────────────────

    async clearStorage(): Promise<void> {
        this.#wallets.clear();
        this.#currencies.clear();
        this.#prices.clear();
        this.#balances.clear();
        this.#totals.clear();
        for (const key of Object.values(KEYS)) {
            this.#store.set(key, "[]");
        }
    }

    // ── Wallet ────────────────────────────────────────────────────────────

    async insertCurvyWallet(wallet: CurvyWallet): Promise<void> {
        if (this.#wallets.has(wallet.id)) {
            throw new StorageError(`Wallet with ID ${wallet.id} already exists in storage`);
        }
        this.#wallets.set(wallet.id, {
            ...wallet.serialize(),
            scanCursors: { latest: undefined, oldest: undefined },
        });
        this.#saveWallets();
    }

    async updateCurvyWalletData(walletId: string, changes: Partial<CurvyWalletData>): Promise<void> {
        const existing = this.#wallets.get(walletId);
        if (!existing) {
            throw new StorageError(`Wallet with ID ${walletId} not found in storage`);
        }
        this.#wallets.set(walletId, {
            ...existing,
            ...changes,
            scanCursors: {
                ...existing.scanCursors,
                ...(changes.scanCursors ?? {}),
            },
        });
        this.#saveWallets();
    }

    async getCurvyWalletDataById(id: string): Promise<CurvyWalletData> {
        const wallet = this.#wallets.get(id);
        if (!wallet) {
            throw new StorageError(`Wallet with ID ${id} not found`);
        }
        return wallet;
    }

    // ── Currency metadata ─────────────────────────────────────────────────

    async upsertCurrencyMetadata(metadata: Map<string, CurrencyMetadata>): Promise<void> {
        this.#currencies.clear();
        for (const [k, v] of metadata.entries()) {
            this.#currencies.set(k, v);
        }
        this.#saveCurrencies();
    }

    async getCurrencyMetadata(addressOrId: string | bigint, networkSlug: string): Promise<CurrencyMetadata> {
        let meta: CurrencyMetadata | undefined;
        if (typeof addressOrId === "bigint") {
            meta = [...this.#currencies.values()].find(
                (c) => c.vaultTokenId === addressOrId.toString() && c.networkSlug === networkSlug,
            );
        } else {
            meta = this.#currencies.get(this.#currencyKey({ address: addressOrId, networkSlug }));
        }
        if (!meta) {
            throw new StorageError(
                `Currency metadata for address / vaultTokenId ${addressOrId} on network ${networkSlug} not found`,
            );
        }
        return meta;
    }

    // ── Price data ────────────────────────────────────────────────────────

    async upsertPriceData(data: Map<string, PriceData>): Promise<void> {
        this.#prices.clear();
        for (const [k, v] of data.entries()) {
            this.#prices.set(k, v);
        }
        this.#savePrices();
    }

    async getCurrencyPrice(token: string): Promise<PriceData> {
        const price = this.#prices.get(token);
        if (!price) {
            throw new StorageError(`Price for token ${token} not found`);
        }
        return price;
    }

    async getPriceFeed(): Promise<Map<string, PriceData>> {
        return this.#prices;
    }

    // ── Balance entries ───────────────────────────────────────────────────

    async updateBalanceEntries(walletId: string, networkSlug: string, entries: BalanceEntry[]): Promise<void> {
        if (entries.length > 0 && !entries.every((e) => e.networkSlug === networkSlug && e.walletId === walletId)) {
            throw new Error("All entries must match the provided walletId and networkSlug");
        }

        // Collect existing entries for this wallet+network
        const existing: BalanceEntry[] = [];
        for (const e of this.#balances.values()) {
            if (e.walletId === walletId && e.networkSlug === networkSlug) {
                existing.push(e);
            }
        }

        if (entries.length === 0 && existing.length === 0) return;

        // Remove stale entries not present in new list
        const newIdSet = new Set(entries.map((e) => e.id));
        for (const old of existing) {
            if (!newIdSet.has(old.id)) {
                this.#balances.delete(this.#balanceKey(old));
            }
        }

        // Compute per-token balance deltas and update totals
        const tokenKeys = new Set<string>();
        for (const e of [...existing, ...entries]) {
            tokenKeys.add(`${e.currencyAddress}::${e.networkSlug}`);
        }

        for (const tokenKey of tokenKeys) {
            const sepIdx = tokenKey.indexOf("::");
            const currency = tokenKey.slice(0, sepIdx);
            const netSlug = tokenKey.slice(sepIdx + 2);
            const newSum = entries
                .filter((e) => e.currencyAddress === currency && e.networkSlug === netSlug)
                .reduce((s, e) => s + BigInt(e.balance), 0n);
            const oldSum = existing
                .filter((e) => e.currencyAddress === currency && e.networkSlug === netSlug)
                .reduce((s, e) => s + BigInt(e.balance), 0n);
            const delta = newSum - oldSum;
            if (delta !== 0n) {
                // At least one of entries or existing is non-empty since we built tokenKeys from them.
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const sample = (entries[0] ?? existing[0])!;
                await this.#updateTotal(walletId, currency, netSlug, sample.environment, sample.symbol, delta);
            }
        }

        // Upsert new entries
        for (const entry of entries) {
            this.#balances.set(this.#balanceKey(entry), entry);
        }

        this.#saveBalances();
        this.#saveTotals();
    }

    async removeSpentBalanceEntries(entries: BalanceEntry[]): Promise<void> {
        if (entries.length === 0) return;
        const walletIds = new Set(entries.map((e) => e.walletId));
        if (walletIds.size > 1) {
            throw new Error("Tried to remove spent balance entries for multiple wallets at once");
        }
        // entries.length > 0 guaranteed by guard above
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const first = entries[0]!;
        await this.updateBalanceEntries(
            first.walletId,
            first.networkSlug,
            entries.map((e) => ({ ...e, balance: 0n })),
        );
    }

    async getBalances(walletId: string, environment?: NETWORK_ENVIRONMENT_VALUES): Promise<BalanceEntry[]> {
        return [...this.#balances.values()].filter(
            (e) => e.walletId === walletId && (!environment || e.environment === environment),
        );
    }

    async getTotals(walletId: string, environment?: NETWORK_ENVIRONMENT_VALUES): Promise<TotalBalance[]> {
        return [...this.#totals.values()].filter(
            (t) => t.walletId === walletId && (!environment || t.environment === environment),
        );
    }

    async getBalancesByCurrencyAndNetwork(
        walletId: string,
        currencyAddress: string,
        networkSlug: string,
    ): Promise<BalanceEntry[]> {
        return [...this.#balances.values()].filter(
            (e) => e.walletId === walletId && e.currencyAddress === currencyAddress && e.networkSlug === networkSlug,
        );
    }

    // ── Private helpers ───────────────────────────────────────────────────

    async #updateTotal(
        walletId: string,
        currencyAddress: string,
        networkSlug: string,
        environment: NETWORK_ENVIRONMENT_VALUES,
        symbol: string,
        delta: bigint,
    ): Promise<void> {
        if (delta === 0n) return;
        const key = this.#totalKey({ walletId, currencyAddress, networkSlug });
        const current = this.#totals.get(key);
        const oldValue = BigInt(current?.totalBalance ?? "0");
        const newValue = oldValue + delta;
        if (newValue > 0n) {
            this.#totals.set(key, {
                walletId,
                currencyAddress,
                networkSlug,
                environment,
                symbol,
                totalBalance: newValue.toString(),
                lastUpdated: Date.now(),
            });
        } else {
            this.#totals.delete(key);
        }
    }
}

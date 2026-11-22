/* tslint:disable */
/* eslint-disable */
/**
 * Transaction fields prepared by the core. The caller supplies gas, nonce, and sender.
 */
export interface Call {
    to: Hex;
    data: Hex;
    value: bigint;
}

export type Hex = `0x${string}`;


/**
 * A known Railgun deployment and its contract configuration.
 */
export class Chain {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Find a configured deployment. Unknown chains return undefined.
     */
    static fromChainId(chain_id: bigint): Chain | undefined;
    static mainnet(): Chain;
    static sepolia(): Chain;
    readonly chainId: bigint;
    readonly deploymentBlock: bigint;
    readonly poiEndpoint: string;
    readonly poiStartBlock: bigint;
    readonly railgunSmartWallet: string;
    readonly subsquidEndpoint: string;
    readonly unshieldFeeBps: number;
    readonly wrappedBaseToken: string;
}

/**
 * A PPOI-enabled wallet. The caller owns encryption and must persist
 * `checkpointJson()` after each successful sync or proof-processing pass.
 */
export class PoiSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    balancesJson(): Promise<string>;
    /**
     * Caller-encrypted checkpoint. Persist it after sync and proof processing.
     */
    checkpointJson(): string;
    notesJson(): Promise<string>;
    /**
     * Open a known-chain wallet with caller-supplied RPC and encrypted-storage
     * plaintext. The JSON checkpoint is from `checkpointJson()` or omitted for
     * a full resync; old combined SDK checkpoints are intentionally unsupported.
     */
    static open(chain: Chain, rpc_url: string, spending_key: string, viewing_key: string, checkpoint_json?: string | null, artifact_base_url?: string | null): Promise<PoiSession>;
    poiListKeysJson(): string;
    poiPendingJson(): string;
    poiRecoveredValidJson(): string;
    poiStatusPerListJson(blinded_commitment: string): string;
    /**
     * Prove a private transfer and prepare its signed paymaster `UserOperation`.
     * Persist `checkpointJson()` before submitting `signed` to the bundler.
     */
    prepareTransferUserOpJson(recipient: RailgunAddress, token: string, amount: bigint, memo: string, account_private_key: string, bundler_url: string): Promise<string>;
    /**
     * Prove an unshield and prepare a signed paymaster `UserOperation`. For
     * native ETH, unshield WETH and prefix `WETH.withdraw` before user calls.
     * User calls may only execute on the unshield recipient's own 7702 account.
     * The amount is the desired recipient amount; protocol fee is added on top.
     */
    prepareUnshieldUserOpJson(recipient: string, token: string, amount: bigint, unwrap_native: boolean, tail_calls_json: string, account_private_key: string, bundler_url: string): Promise<string>;
    /**
     * Generate and send queued proofs. The JSON report describes attempts,
     * not POI acceptance. Sync lists again before displaying Valid.
     */
    processPendingPoiJson(): Promise<string>;
    /**
     * Refresh PPOI/TXIDs and recover missing proofs without submitting them.
     */
    refreshPoi(): Promise<void>;
    /**
     * History-only window; call refreshPoi after the final window.
     */
    syncHistoryTo(block: bigint): Promise<void>;
    /**
     * Bounded variant for resumable first syncs. Persist `checkpointJson()`
     * after every successful window.
     */
    syncToWithoutPoiSubmission(block: bigint): Promise<void>;
    /**
     * Sync UTXOs, TXIDs, and PPOI lists; recover old missing proofs into the
     * pending queue without sending any proof to the PPOI node.
     */
    syncWithoutPoiSubmission(): Promise<void>;
    readonly address: string;
    readonly syncedBlock: bigint;
}

/**
 * A Railgun recipient address. Chain IDs are advisory in the core protocol.
 */
export class RailgunAddress {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Return the address with an all-chains advisory hint.
     */
    allChains(): RailgunAddress;
    /**
     * Derive an address from two 32-byte private keys. Keep the inputs secret.
     */
    static fromPrivateKeys(spending_key: Hex, viewing_key: Hex, chain_id: bigint): RailgunAddress;
    /**
     * Construct an address from the public master and viewing keys.
     */
    static fromPublicKeys(master_key: Hex, viewing_public_key: Hex, chain_id: bigint): RailgunAddress;
    /**
     * Parse and validate a Bech32m Railgun address.
     */
    static parse(text: string): RailgunAddress;
    toString(): string;
}

/**
 * Prepare one or more Railgun shields without broadcasting or persisting state.
 */
export class Shield {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add an ERC20 shield. Amount is in token base units.
     */
    addErc20(recipient: RailgunAddress, token: Hex, amount: bigint): void;
    /**
     * Add a native-currency shield. Amount is in wei.
     */
    addNative(recipient: RailgunAddress, amount: bigint): void;
    /**
     * Build transaction calls. ERC20 shielding also requires caller-managed approval.
     */
    build(): Call[];
    constructor(chain: Chain);
}

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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly poisession_prepareTransferUserOpJson: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number) => any;
    readonly poisession_prepareUnshieldUserOpJson: (a: number, b: number, c: number, d: number, e: number, f: any, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => any;
    readonly __wbg_poisession_free: (a: number, b: number) => void;
    readonly poisession_address: (a: number) => [number, number];
    readonly poisession_balancesJson: (a: number) => any;
    readonly poisession_checkpointJson: (a: number) => [number, number, number, number];
    readonly poisession_notesJson: (a: number) => any;
    readonly poisession_open: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => any;
    readonly poisession_poiListKeysJson: (a: number) => [number, number, number, number];
    readonly poisession_poiPendingJson: (a: number) => [number, number, number, number];
    readonly poisession_poiRecoveredValidJson: (a: number) => [number, number, number, number];
    readonly poisession_poiStatusPerListJson: (a: number, b: number, c: number) => [number, number, number, number];
    readonly poisession_processPendingPoiJson: (a: number) => any;
    readonly poisession_refreshPoi: (a: number) => any;
    readonly poisession_syncHistoryTo: (a: number, b: any) => any;
    readonly poisession_syncToWithoutPoiSubmission: (a: number, b: any) => any;
    readonly poisession_syncWithoutPoiSubmission: (a: number) => any;
    readonly poisession_syncedBlock: (a: number) => bigint;
    readonly __wbg_chain_free: (a: number, b: number) => void;
    readonly __wbg_shield_free: (a: number, b: number) => void;
    readonly chain_chainId: (a: number) => bigint;
    readonly chain_deploymentBlock: (a: number) => bigint;
    readonly chain_fromChainId: (a: any) => [number, number, number];
    readonly chain_mainnet: () => number;
    readonly chain_poiEndpoint: (a: number) => [number, number];
    readonly chain_poiStartBlock: (a: number) => bigint;
    readonly chain_railgunSmartWallet: (a: number) => [number, number];
    readonly chain_sepolia: () => number;
    readonly chain_subsquidEndpoint: (a: number) => [number, number];
    readonly chain_unshieldFeeBps: (a: number) => number;
    readonly chain_wrappedBaseToken: (a: number) => [number, number];
    readonly shield_addErc20: (a: number, b: number, c: any, d: any) => [number, number];
    readonly shield_addNative: (a: number, b: number, c: any) => [number, number];
    readonly shield_build: (a: number) => [number, number, number];
    readonly shield_new: (a: number) => number;
    readonly __wbg_railgunaddress_free: (a: number, b: number) => void;
    readonly railgunaddress_allChains: (a: number) => number;
    readonly railgunaddress_fromPrivateKeys: (a: any, b: any, c: any) => [number, number, number];
    readonly railgunaddress_fromPublicKeys: (a: any, b: any, c: any) => [number, number, number];
    readonly railgunaddress_parse: (a: number, b: number) => [number, number, number];
    readonly railgunaddress_toString: (a: number) => [number, number];
    readonly __wbg_trap_free: (a: number, b: number) => void;
    readonly trap___wbg_wasmer_trap: () => void;
    readonly wasm_bindgen_c2db0c93d537ef26___closure__destroy___dyn_core_9b3796e30d99ddb7___ops__function__FnMut_____Output_______: (a: number, b: number) => void;
    readonly wasm_bindgen_c2db0c93d537ef26___closure__destroy___dyn_core_9b3796e30d99ddb7___ops__function__FnMut_____Output________1_: (a: number, b: number) => void;
    readonly wasm_bindgen_c2db0c93d537ef26___closure__destroy___dyn_core_9b3796e30d99ddb7___ops__function__FnMut__wasm_bindgen_c2db0c93d537ef26___JsValue____Output_______: (a: number, b: number) => void;
    readonly wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke___wasm_bindgen_c2db0c93d537ef26___JsValue__wasm_bindgen_c2db0c93d537ef26___JsValue_____: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke___wasm_bindgen_c2db0c93d537ef26___JsValue_____: (a: number, b: number, c: any) => void;
    readonly wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke______: (a: number, b: number) => void;
    readonly wasm_bindgen_c2db0c93d537ef26___convert__closures_____invoke_______1_: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_export: WebAssembly.Table;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;

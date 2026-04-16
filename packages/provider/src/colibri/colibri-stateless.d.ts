/* eslint-disable import/no-default-export */
declare module '@corpus-core/colibri-stateless' {
    export class ProviderRpcError extends Error {
        public code: number;
        public data?: unknown;
        constructor(code: number, message: string, data?: unknown);
        static createError(error: unknown, args?: RequestArguments): ProviderRpcError;
    }

    export interface ColibriClient {
        rpc(method: string, params: unknown[], method_type?: MethodType): Promise<unknown>;
        getMethodSupport(method: string, args?: unknown[]): Promise<MethodType>;
    }

    export type FetchRpc = (
        urls: string[],
        payload: unknown,
        as_proof: boolean,
        fetchFn?: typeof globalThis.fetch,
    ) => Promise<unknown>;

    export type ProofStrategy = (
        client: ColibriClient,
        req: RequestArguments,
        config: Config,
        fetch_rpc: FetchRpc,
    ) => Promise<unknown>;

    export type WarningHandler = (req: RequestArguments, message: string) => Promise<unknown>;

    export interface RequestArguments {
        readonly method: string;
        readonly params?: readonly unknown[] | object;
    }

    export interface ProviderConnectInfo {
        readonly chainId: string;
    }

    export interface ProviderMessage {
        readonly type: string;
        readonly data: unknown;
    }

    export type PrivacyMode = 'none' | 'basic';

    export interface Cache {
        cacheable(req: DataRequest): boolean;
        get(
            req: DataRequest,
        ): Uint8Array | undefined | null | Promise<Uint8Array | undefined | null>;
        set(req: DataRequest, data: Uint8Array): void;
    }

    export interface ChainConfig {
        beacon_apis: string[];
        rpcs: string[];
        prover?: string[];
        checkpointz?: string[];
        trusted_checkpoint?: string;
        verify?: (method: string, args: unknown[]) => boolean;
        pollingInterval?: number;
        proofStrategy?: ProofStrategy;
        verifyTransactions?: boolean;
    }

    export interface EIP1193Client {
        request(args: RequestArguments): Promise<unknown>;
        on(event: string, callback: (data: unknown) => void): this;
        removeListener(event: string, callback: (data: unknown) => void): this;
    }

    export type ProverMode = 'local' | 'remote' | 'hybrid' | 'proxy' | 'light_client';

    export interface DataRequest {
        method: string;
        chain_id: number;
        encoding: string;
        type: string;
        exclude_mask: number;
        url: string;
        payload: unknown;
        req_ptr: number;
    }

    export interface Config extends ChainConfig {
        chainId: number | string;
        checkpoint_witness_keys?: string;
        cache?: Cache;
        debug?: boolean;
        include_code?: boolean;
        use_accesslist?: boolean;
        privacy_mode?: PrivacyMode;
        zk_proof?: boolean;
        prover_mode?: ProverMode;
        chains: {
            [chainId: number]: ChainConfig;
        };
        fallback_provider?: EIP1193Client;
        warningHandler: WarningHandler;
        onTransfer?: (size: number, req: DataRequest) => void;
        fetch?: typeof globalThis.fetch;
    }

    export enum MethodType {
        PROOFABLE = 1,
        UNPROOFABLE = 2,
        NOT_SUPPORTED = 3,
        LOCAL = 4,
    }

    class Colibri {
        constructor(config?: Partial<Config>);
        request(args: RequestArguments): Promise<unknown>;
    }

    export default Colibri;
}

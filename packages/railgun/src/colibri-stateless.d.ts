declare module '@corpus-core/colibri-stateless' {
    export interface RequestArguments {
        method: string;
        params?: unknown[] | Record<string, unknown>;
    }

    export interface Cache {
        cacheable(req: DataRequest): boolean;
        get(req: DataRequest): Uint8Array | undefined;
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
        proofStrategy?: unknown;
        verifyTransactions?: boolean;
    }

    export interface EIP1193Client {
        request(args: RequestArguments): Promise<unknown>;
        on(event: string, callback: (data: unknown) => void): this;
        removeListener(event: string, callback: (data: unknown) => void): this;
    }

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

    export interface C4Config extends ChainConfig {
        chainId: number | string;
        checkpoint_witness_keys?: string;
        cache?: Cache;
        debug?: boolean;
        include_code?: boolean;
        zk_proof?: boolean;
        chains: {
            [chainId: number]: ChainConfig;
        };
        fallback_provider?: EIP1193Client;
        warningHandler?: (req: RequestArguments, message: string) => Promise<unknown>;
    }

    class Colibri {
        constructor(config?: Partial<C4Config>);
        request(args: RequestArguments): Promise<unknown>;
    }

    export default Colibri;
}



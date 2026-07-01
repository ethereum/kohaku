/* eslint-disable import/no-default-export */
declare module '@status-im/nimbus-verified-proxy' {
    export type ExecutionTransport = (url: string, name: string, params: unknown[]) => Promise<string>;
    export type BeaconTransport = (url: string, endpoint: string, params: unknown) => Promise<string>;

    export interface NVPConfig {
        trustedBlockRoot: string;
        executionApiUrls: string;
        beaconApiUrls: string;
        eth2Network?: string;
    }

    export interface NVPTransports {
        executionTransport?: ExecutionTransport;
        beaconTransport?: BeaconTransport;
    }

    export interface RequestArguments {
        readonly method: string;
        readonly params?: readonly unknown[] | object;
    }

    class NimbusVerifiedProxy {
        init(config: string, transports?: NVPTransports): Promise<void>;
        call(name: string, params: string): Promise<string>;
        request(args: RequestArguments): Promise<unknown>;
        destroy(): void;
    }

    export default NimbusVerifiedProxy;
}

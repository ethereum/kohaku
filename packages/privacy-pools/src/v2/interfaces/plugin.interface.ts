import type { AssetAmount, PluginInstance } from "@kohaku-eth/plugins";
import type { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import type {
    CircuitManifest,
    DeploymentAddresses,
    Hex,
    IASPClient,
    IASPDataProvider,
    IEntrypointInteractor,
    IProofService,
    IRelayerInteractor,
    PublicKey,
    RelayerInfo,
} from "@privacy-pools-v2/sdk";
import type { Address } from "ox/Address";
import type { PPv2AssetId } from "../mapping/assets";
import type {
    PPv2BroadcastResult,
    PPv2Note,
    PPv2PrivateOperation,
    PPv2PublicOperation,
} from "./operations.interface";

/** Recipient identity for cold-start transfers: any EVM address (FR-021). */
export type PPv2AccountId = Address & string;

/** Per-asset amount with spendable/unspendable tagging (US4). */
export type PPv2AssetAmount = AssetAmount<PPv2AssetId, bigint, "spendable" | "unspendable">;

/**
 * Protocol-specific methods with no Kohaku verb. Type-level only: these members
 * merge onto the plugin instance root via the capability intersection (FR-025,
 * v1 precedent).
 */
export type PPv2Extras = {
    isRegistered(): Promise<boolean>;
    prepareRegisterKeystore(): Promise<PPv2PublicOperation>;
    prepareRageQuit(commitment: Hex): Promise<PPv2PublicOperation>;
    sync(): Promise<void>;
    /** Wallet-facing blob wrapping the SDK `AccountExport` (cleartext, no raw keys). */
    exportAccount(): Promise<string>;
    importAccount(blob: string): Promise<void>;
};

/** The broadcaster contract for private operations (FR-050). */
export type PPv2Broadcaster = Broadcaster<PPv2PrivateOperation, PPv2BroadcastResult>;

/**
 * Optional test seams, mirroring the v1 plugin's factory overrides (FR-002).
 * Each maps onto the corresponding `PoolSessionBuilder.withX()` override; when
 * one is supplied, the conflicting declarative config field is omitted
 * automatically (see `assemblePoolSession`). Production wallets never set these.
 */
export type PPv2Factories = {
    /** Replaces the HTTP ASP client (deposit-side pubkey, merkle proofs). */
    aspClient?: IASPClient;
    /** Replaces the ASP data provider (discovery-side label statuses + event snapshot). */
    aspDataProvider?: IASPDataProvider;
    /** Replaces the relayer client (quotes + relay submission). */
    relayerInteractor?: IRelayerInteractor;
    /** Replaces Groth16 proving/verification (skips artifact fetch + real proving). */
    proofService?: IProofService;
    /** Replaces Entrypoint reads/encoding (asset config, allowance, deposit calldata). */
    entrypointInteractor?: IEntrypointInteractor;
};

/**
 * The Privacy Pools v2 plugin instance. Multi-asset batch verbs are disabled
 * (FR-024); `note` is set so `notes()` is exposed; `extras` merge onto the root.
 */
export type PPv2Instance = PluginInstance<
    PPv2AccountId,
    {
        assetAmounts: {
            input: PPv2AssetAmount;
            internal: PPv2AssetAmount;
            output: PPv2AssetAmount;
            read: PPv2AssetAmount;
        };
        privateOp: PPv2PrivateOperation;
        publicOp: PPv2PublicOperation;
        note: PPv2Note;
        features: {
            prepareShield: true;
            prepareTransfer: true;
            prepareUnshield: true;
            prepareShieldMulti: false;
            prepareTransferMulti: false;
            prepareUnshieldMulti: false;
        };
        extras: PPv2Extras;
    }
>;

/**
 * Everything deployment-specific, so the plugin hardcodes no environment (FR-002).
 * Contract addresses default from the SDK `DEPLOYMENTS` map when omitted.
 */
export type PPv2PluginParameters = {
    chainId: bigint;
    /** Wallet account that sends public operations; also the instance id (FR-014, DEP-6). */
    ownerAddress: Address;
    /** SDK contract addresses; falls back to `DEPLOYMENTS[chainId]`. */
    deployment?: DeploymentAddresses;
    /** ASP endpoint; pin the public key (not authenticated on-chain, DEP-4). */
    asp: { baseUrl: string; publicKey?: PublicKey };
    /** Must contain at least one relayer (transfers/unshields need one, DEP-5). */
    relayers: RelayerInfo[];
    /** Circuit artifact source: IPFS gateways + pinned CID manifest (FR-040, DEP-3). */
    artifacts: { gatewayUrls: string[]; manifest: CircuitManifest };
    accountIndex?: number;
    /** Gap limit for revocable-key-index recovery on a fresh device (default 20, R3). */
    revocableKeyGapLimit?: number;
    /** Storage namespace discriminator for co-resident instances (INV-6). */
    storeKey?: string;
    factories?: PPv2Factories;
};

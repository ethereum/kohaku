/**
 * Public surface of the Privacy Pools v2 plugin (`@kohaku-eth/privacy-pools`).
 * Consumers depend only on these `@kohaku-eth/*` types plus `@kohaku-eth/plugins`
 * — never on `@privacy-pools-v2/sdk` directly (SC-001).
 */
export { createPPv2Plugin, PPv2Plugin } from "./plugin";

export type {
    PPv2AccountId,
    PPv2AssetAmount,
    PPv2Broadcaster,
    PPv2Extras,
    PPv2Factories,
    PPv2Instance,
    PPv2PluginParameters,
} from "./interfaces/plugin.interface";

export type {
    PPv2BroadcastResult,
    PPv2Note,
    PPv2PrivateOperation,
    PPv2PublicOperation,
} from "./interfaces/operations.interface";

export type { PPv2AssetId } from "./mapping/assets";

// Typed error hierarchy + SDK→plugin mapping (FR-060).
export * from "./interfaces/errors";

// createPPv2Broadcaster lands with US2 (T039).

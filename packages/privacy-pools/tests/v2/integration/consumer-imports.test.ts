/**
 * SC-001: a wallet integrates shield/transfer/unshield using ONLY
 * `@kohaku-eth/privacy-pools` (here: its public v2 barrel) and
 * `@kohaku-eth/plugins` types — zero imports from `@0xbow-io/privacy-pools-v2-sdk`.
 *
 * This file IS the sample wallet integration: it imports nothing from the SDK
 * (asserted by a source scan below), and the type-level usage compiles under
 * the strict tsconfig, proving the public surface suffices.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { describe, expect, it } from "vitest";
import {
    AccountImportMismatchError,
    AlreadyRegisteredError,
    ArtifactIntegrityError,
    createPPv2Broadcaster,
    createPPv2Plugin,
    InsufficientFundsError,
    LabelFragmentationError,
    NotRegisteredError,
    type PPv2AssetAmount,
    type PPv2BroadcastResult,
    type PPv2Instance,
    type PPv2Note,
    type PPv2PluginParameters,
    type PPv2PrivateOperation,
    type PPv2PublicOperation,
    PPv2Plugin,
    QuoteExpiredError,
    RelayerUnavailableError,
    StorageCorruptionError,
} from "../../../src/v2";

// Type-level integration surface a wallet would write (compile-time proof).
type WalletSide = {
    plugin: PPv2Instance;
    broadcaster: Broadcaster<PPv2PrivateOperation, PPv2BroadcastResult>;
    holdings: PPv2AssetAmount[];
    detail: PPv2Note[];
    publicOp: PPv2PublicOperation;
};

describe("consumer imports (SC-001)", () => {
    it("exposes the full wallet-facing surface from the public entry", () => {
        expect(typeof createPPv2Plugin).toBe("function");
        expect(typeof createPPv2Broadcaster).toBe("function");
        expect(typeof PPv2Plugin).toBe("function");

        for (const errorClass of [
            NotRegisteredError,
            AlreadyRegisteredError,
            InsufficientFundsError,
            LabelFragmentationError,
            QuoteExpiredError,
            ArtifactIntegrityError,
            StorageCorruptionError,
            RelayerUnavailableError,
            AccountImportMismatchError,
        ]) {
            expect(typeof errorClass).toBe("function");
        }
    });

    it("this sample integration imports nothing from @0xbow-io/privacy-pools-v2-sdk", async () => {
        const self = await readFile(fileURLToPath(import.meta.url), "utf8");
        const importLines = self
            .split("\n")
            .filter((line) => /^\s*import[\s{]/.test(line) || /from\s+["']/.test(line));

        expect(importLines.some((line) => line.includes("@0xbow-io/privacy-pools-v2-sdk"))).toBe(false);
    });

    it("the public parameter type is expressible without SDK value imports", () => {
        // Structural construction of PPv2PluginParameters — a wallet supplies plain
        // data; SDK-shaped fields (manifest, relayers) are plain JSON-able objects.
        const params: PPv2PluginParameters = {
            chainId: 11155111n,
            ownerAddress: "0x00000000000000000000000000000000000000aa",
            asp: { baseUrl: "https://asp.example" },
            relayers: [],
            artifacts: { gatewayUrls: ["https://ipfs.example/ipfs"], manifest: {} },
        };

        expect(params.chainId).toBe(11155111n);
        const _typecheckOnly: WalletSide | null = null;

        expect(_typecheckOnly).toBeNull();
    });
});

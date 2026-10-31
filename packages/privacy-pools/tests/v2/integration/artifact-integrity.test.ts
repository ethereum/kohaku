/**
 * T064 (F5, FR-040): with NO proof-service override, the builder wires the REAL
 * `ProofService` + `IpfsCircuitArtifacts` over the plugin's `KohakuHttpClient`
 * (host fetch). Every gateway's bytes are digest-checked against the pinned CID:
 * the SDK falls back through gateways for availability, but tampered bytes are
 * accepted from none, and the aggregate failure crosses the plugin boundary as a
 * typed `ArtifactIntegrityError` — with no note state mutated.
 *
 * Uses the ragequit flow: it is the only proving flow whose witness needs just
 * the keystore leaf tree (minted on the mock chain), no relayer quotes.
 */
import type { Address } from "viem";
import { describe, expect, it, vi } from "vitest";
import type { Host } from "@kohaku-eth/plugins";
import { persistRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import { ArtifactIntegrityError } from "../../../src/v2/interfaces/errors";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Plugin } from "../../../src/v2/plugin";
import { chainWithLogs, mintKeystoreLeafLog, mintOwnedNoteLog } from "../utils/mock-chain";
import { createMockHost } from "../utils/mock-host";
import { createMockAsp, createMockEntrypoint, createMockRelayer } from "../utils/mock-services";

const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const CHAIN_ID = 11155111n;

// Pinned (valid, resolvable) CIDs whose digests can never match the tampered bytes.
const CIDS = {
    wasm: "bafkreiesi2bkdwkqjzipx5oczraupyma77l7owo57qf7jsw4jsofi5sh2a",
    provingKey: "bafkreieyo6egnxzqgmd73vlddepe7rwonkqwzhfto64ujwiamks6thluce",
    verificationKey: "bafkreiai35msryolmahocnquqsjunrqnnqex3f5fuu4x23fkvbchl5xt5m",
};

/** Plugin params with real artifact fetching (no proofService override) over mock seams. */
function params(): PPv2PluginParameters {
    const asp = createMockAsp();

    return {
        chainId: CHAIN_ID,
        ownerAddress: OWNER,
        asp: { baseUrl: "https://asp.mock" },
        relayers: [],
        artifacts: {
            // Two gateways so the fail-closed assertion is real: tampered bytes
            // must be rejected from EVERY gateway, not just the first.
            gatewayUrls: ["https://ipfs.mock/ipfs", "https://fallback.mock/ipfs"],
            manifest: { transact_1x1: CIDS, ragequit: CIDS },
        },
        // No proofService override: the REAL artifact-fetch + integrity path runs.
        factories: {
            aspClient: asp,
            aspDataProvider: asp,
            relayerInteractor: createMockRelayer(),
            entrypointInteractor: createMockEntrypoint(),
        },
    };
}

describe("artifact integrity (T064/F5, FR-040)", () => {
    it("rejects tampered gateway bytes with ArtifactIntegrityError and mutates nothing", async () => {
        const bare = createMockHost();
        const minted = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 1000n,
            blockNumber: 1n,
        });
        const keystoreLeaf = await mintKeystoreLeafLog(bare.host, OWNER, 2n);

        // The "gateway": serves bytes that do NOT hash to any pinned CID.
        const gatewayFetch = vi.fn(async () =>
            new Response(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), { status: 200 }),
        ) as unknown as Host["network"]["fetch"];

        const rig = createMockHost({
            rpc: chainWithLogs([minted.log, keystoreLeaf.log]),
            blockNumber: 100n,
            fetch: gatewayFetch,
        });

        await persistRevocableKeyIndex(
            new KohakuStorageService(rig.host.storage),
            CHAIN_ID,
            OWNER,
            "0x0",
        );

        const plugin = await createPPv2Plugin(rig.host, params());

        // The note is discovered and active before the ragequit attempt.
        const before = await plugin.notes();

        expect(before).toHaveLength(1);
        expect(before[0].status).toBe("active");

        // Ragequit proving loads the "ragequit" circuit through the real
        // IpfsCircuitArtifacts → KohakuHttpClient → host fetch. Digest mismatch.
        await expect(plugin.prepareRageQuit(minted.commitment)).rejects.toBeInstanceOf(
            ArtifactIntegrityError,
        );

        // It really went through the gateways (host fetch), not a stub prover.
        // The SDK falls back through EVERY gateway for availability, digest-checks
        // each one's bytes, and only then fails closed — so both gateways were
        // tried and the tampered bytes were accepted from neither.
        const fetchedUrls = (gatewayFetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
            ([input]) => String(input),
        );

        expect(fetchedUrls.some((u) => u.startsWith("https://ipfs.mock/ipfs"))).toBe(true);
        expect(fetchedUrls.some((u) => u.startsWith("https://fallback.mock/ipfs"))).toBe(true);

        // Fail-closed: nothing marked, nothing lost.
        const after = await plugin.notes(undefined, true);

        expect(after).toHaveLength(1);
        expect(after[0].status).toBe("active");

        const balances = await plugin.balance(undefined);

        expect(balances.find((b) => b.tag === "spendable")?.amount).toBe(1000n);
    });
});

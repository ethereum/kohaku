/**
 * T050 (US5 AC-1): the full registration arc against a live-flippable mock chain —
 * unregistered account → `prepareRegisterKeystore()` encodes the two public
 * registration calls (setAuthPolicy + setViewingKey) WITHOUT signing or sending
 * (INV-1); after the wallet "mines" them the plugin detects the on-chain
 * registration and refuses to encode a second one.
 */
import type { Address } from "viem";
import { pad } from "viem";
import { describe, expect, it } from "vitest";
import { AlreadyRegisteredError } from "../../../src/v2/interfaces/errors";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Plugin } from "../../../src/v2/plugin";
import { createMockHost } from "../utils/mock-host";
import {
    createMockAsp,
    createMockEntrypoint,
    createMockProofService,
    createMockRelayer,
} from "../utils/mock-services";

const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const CHAIN_ID = 11155111n;

/** Offline plugin params wired to fresh mock ASP/relayer/proof/entrypoint seams. */
function params(): PPv2PluginParameters {
    const asp = createMockAsp();

    return {
        chainId: CHAIN_ID,
        ownerAddress: OWNER,
        asp: { baseUrl: "https://asp.mock" },
        relayers: [],
        artifacts: {
            gatewayUrls: ["https://ipfs.mock/ipfs"],
            manifest: {
                transact_1x1: {
                    wasm: "bafkreiesi2bkdwkqjzipx5oczraupyma77l7owo57qf7jsw4jsofi5sh2a",
                    provingKey: "bafkreieyo6egnxzqgmd73vlddepe7rwonkqwzhfto64ujwiamks6thluce",
                    verificationKey: "bafkreiai35msryolmahocnquqsjunrqnnqex3f5fuu4x23fkvbchl5xt5m",
                },
            },
        },
        factories: {
            aspClient: asp,
            aspDataProvider: asp,
            relayerInteractor: createMockRelayer(),
            proofService: createMockProofService(),
            entrypointInteractor: createMockEntrypoint(),
        },
    };
}

describe("registration lifecycle (T050/US5 AC-1)", () => {
    it("encodes register txs while unregistered, detects the mined registration, then refuses", async () => {
        // Live-flippable chain: `isKeystoreRegistered` (eth_call) answers false
        // until the wallet mines the registration.
        let mined = false;
        const rig = createMockHost({
            rpc: {
                eth_call: () => (mined ? pad("0x1") : pad("0x0")),
                eth_getLogs: () => [],
            },
            blockNumber: 100n,
        });

        const plugin = await createPPv2Plugin(rig.host, params());

        expect(await plugin.isRegistered()).toBe(false);

        // Unregistered → a public operation with both registration calls, encoded
        // but never signed/sent (INV-1: plain TxData for the wallet to submit).
        const op = await plugin.prepareRegisterKeystore();

        expect(op.__type).toBe("publicOperation");
        expect(op.txs).toHaveLength(2);

        for (const tx of op.txs) {
            expect(tx.to).toMatch(/^0x[0-9a-fA-F]{40}$/);
            expect(tx.data.length).toBeGreaterThan(10);
            expect(tx.value).toBe(0n);
        }

        // The wallet signs + mines them; the plugin now detects the registration.
        mined = true;

        expect(await plugin.isRegistered()).toBe(true);

        // And refuses to encode a duplicate registration (US5 AC-3 guard).
        await expect(plugin.prepareRegisterKeystore()).rejects.toBeInstanceOf(
            AlreadyRegisteredError,
        );
    });
});

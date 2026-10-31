import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Plugin, PPv2Plugin } from "../../../src/v2/plugin";
import { createMockHost } from "../utils/mock-host";

const OWNER = "0x00000000000000000000000000000000000000aa" as Address;

/** Syntactically valid address made of one repeated hex digit. */
function dummyAddr(byte: string): Address {
    return `0x${byte.repeat(40)}` as Address;
}

/** Construction-only plugin params: dummy deployment/relayer/CIDs, no factories. */
function params(): PPv2PluginParameters {
    return {
        chainId: 11155111n,
        ownerAddress: OWNER,
        deployment: {
            poolAddress: dummyAddr("1"),
            entrypointAddress: dummyAddr("2"),
            keystoreAddress: dummyAddr("3"),
            aspRegistryAddress: dummyAddr("4"),
        },
        asp: { baseUrl: "https://asp.example" },
        relayers: [
            {
                url: "https://relayer.example",
                name: "mock",
                chainId: 11155111,
                chainType: "evm",
                status: "active",
                address: dummyAddr("5"),
                processorAddress: dummyAddr("6"),
            },
        ],
        artifacts: {
            gatewayUrls: ["https://ipfs.example/ipfs"],
            // Dummy pinned CIDs — non-empty is all construction requires (no fetch at
            // build); real deployments supply real CIDs (DEP-3).
            manifest: {
                transact_1x1: {
                    wasm: "bafkreiesi2bkdwkqjzipx5oczraupyma77l7owo57qf7jsw4jsofi5sh2a",
                    provingKey: "bafkreieyo6egnxzqgmd73vlddepe7rwonkqwzhfto64ujwiamks6thluce",
                    verificationKey: "bafkreiai35msryolmahocnquqsjunrqnnqex3f5fuu4x23fkvbchl5xt5m",
                },
            },
        },
    };
}

describe("createPPv2Plugin (offline assembly)", () => {
    it("assembles a plugin from a mock host with no network I/O", async () => {
        const { host } = createMockHost();
        const plugin = await createPPv2Plugin(host, params());

        expect(plugin).toBeInstanceOf(PPv2Plugin);
    });

    it("reports the owner address as the instance id", async () => {
        const { host } = createMockHost();
        const plugin = await createPPv2Plugin(host, params());

        expect(await plugin.instanceId()).toBe(OWNER);
    });

    it("derives deterministically: same mnemonic → same keys, different → different", async () => {
        // instanceId() only echoes the configured owner; the registration calldata
        // embeds the DERIVED public key material, so it witnesses real derivation.
        const registrationCalldata = async (mnemonic?: string) => {
            const { host } = createMockHost(mnemonic ? { mnemonic } : {});
            const plugin = await createPPv2Plugin(host, params());
            const op = await plugin.prepareRegisterKeystore();

            return op.txs.map((tx) => tx.data).join("");
        };

        const a = await registrationCalldata();
        const b = await registrationCalldata();
        const other = await registrationCalldata(
            "legal winner thank year wave sausage worth useful legal winner thank yellow",
        );

        expect(a).toBe(b);
        expect(other).not.toBe(a);
    });
});

/**
 * T052 (US5 AC-3): the same mnemonic on a new device re-derives identical keys
 * and recognizes the existing on-chain registration WITHOUT a second
 * registration. Also exercises T060's registered-branch: the fresh-device
 * factory runs the SDK's revocable-key gap scan against the on-chain auth
 * digest, legitimately resolves index 0, and persists it.
 */
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import { readRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import { AlreadyRegisteredError } from "../../../src/v2/interfaces/errors";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Plugin } from "../../../src/v2/plugin";
import { chainWithLogs, mintRegistrationLog } from "../utils/mock-chain";
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

describe("registration recovery on a new device (T052/US5 AC-3)", () => {
    it("recognizes the on-chain registration, resolves the key index, and refuses to re-register", async () => {
        // "New device": empty storage, same mnemonic; the chain holds the
        // account's AuthPolicySet registration event (real index-0 auth digest).
        const registration = await mintRegistrationLog(createMockHost().host);
        const rig = createMockHost({
            rpc: chainWithLogs([registration.log]),
            blockNumber: 100n,
        });

        // No pre-seeded record: the factory's fresh-device branch must run the
        // real gap scan against the on-chain digest and resolve index 0.
        const plugin = await createPPv2Plugin(rig.host, params());

        expect(await plugin.isRegistered()).toBe(true);

        // The discovered rotation index was persisted for subsequent inits (T060).
        const persisted = await readRevocableKeyIndex(
            new KohakuStorageService(rig.host.storage),
            CHAIN_ID,
            OWNER,
        );

        expect(persisted).not.toBeNull();
        expect(BigInt(persisted as string)).toBe(0n);

        // No second registration: the SDK reports alreadyRegistered and the
        // plugin surfaces the typed error instead of returning register txs.
        await expect(plugin.prepareRegisterKeystore()).rejects.toBeInstanceOf(
            AlreadyRegisteredError,
        );
    });
});

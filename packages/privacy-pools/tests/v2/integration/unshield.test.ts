/**
 * T041 (US3 AC-1/2): the full unshield arc over the real SDK pipeline — the
 * withdraw witness built from the same mock-chain tree fixtures, a relayer
 * withdrawal quote, broadcast through the shared session, and post-mine
 * reconciliation: input spent, change note back under the same label.
 */
import type { Address } from "viem";
import { pad } from "viem";
import { describe, expect, it } from "vitest";
import { persistRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import type { PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Broadcaster } from "../../../src/v2/broadcaster";
import { createPPv2Plugin } from "../../../src/v2/plugin";
import {
    chainWithLogs,
    mintKeystoreLeafLog,
    mintOwnedNoteLog,
    mintStateLeavesLog,
} from "../utils/mock-chain";
import { createMockHost } from "../utils/mock-host";
import {
    createMockAsp,
    createMockEntrypoint,
    createMockProofService,
    createMockRelayer,
} from "../utils/mock-services";

const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as Address;
const PAYOUT = "0x00000000000000000000000000000000000000cc" as Address;
const CHAIN_ID = 11155111n;

describe("unshield end-to-end (T041/US3 AC-1/2)", () => {
    it("prepares a withdrawal over real witnesses, relays, and reconciles spent + change", async () => {
        const bare = createMockHost();
        const minted = await mintOwnedNoteLog({
            host: bare.host,
            ownerAddress: OWNER,
            tokenId: NATIVE,
            value: 1000n,
            blockNumber: 1n,
        });
        const stateLeaves = await mintStateLeavesLog([minted.commitment], { blockNumber: 1n });
        const keystoreLeaf = await mintKeystoreLeafLog(bare.host, OWNER, 2n);

        const rig = createMockHost({
            rpc: {
                ...chainWithLogs([minted.log, stateLeaves.log, keystoreLeaf.log]),
                eth_getTransactionReceipt: () => ({
                    transactionHash: pad("0xbeef"),
                    status: "0x1",
                    blockNumber: "0x65",
                    logs: [],
                }),
            },
            blockNumber: 100n,
        });

        await persistRevocableKeyIndex(
            new KohakuStorageService(rig.host.storage),
            CHAIN_ID,
            OWNER,
            "0x0",
        );

        const asp = createMockAsp();
        const relayer = createMockRelayer({ feeAmount: 5n });
        const pluginParams: PPv2PluginParameters = {
            chainId: CHAIN_ID,
            ownerAddress: OWNER,
            asp: { baseUrl: "https://asp.mock" },
            relayers: [],
            artifacts: {
                gatewayUrls: ["https://ipfs.mock/ipfs"],
                manifest: {
                    transact_1x1: {
                        wasm: "bafkreiesi2bkdwkqjzipx5oczraupyma77l7owo57qf7jsw4jsofi5sh2a",
                        provingKey:
                            "bafkreieyo6egnxzqgmd73vlddepe7rwonkqwzhfto64ujwiamks6thluce",
                        verificationKey:
                            "bafkreiai35msryolmahocnquqsjunrqnnqex3f5fuu4x23fkvbchl5xt5m",
                    },
                },
            },
            factories: {
                aspClient: asp,
                aspDataProvider: asp,
                relayerInteractor: relayer,
                proofService: createMockProofService(),
                entrypointInteractor: createMockEntrypoint(),
            },
        };

        const plugin = await createPPv2Plugin(rig.host, pluginParams);

        asp.associationLeaves.push(minted.labelHash);

        expect(
            (await plugin.balance(undefined)).find((b) => b.tag === "spendable")?.amount,
        ).toBe(1000n);

        // Prepare the withdrawal to a public payout address; inputs stay active.
        const op = await plugin.prepareUnshield(
            { asset: { __type: "native" }, amount: 700n },
            PAYOUT,
        );

        expect(op.kind).toBe("withdrawal");
        expect((await plugin.notes())[0].status).toBe("active");

        // Broadcast: re-prove, relay the withdrawal, mine, reconcile.
        const result = await createPPv2Broadcaster(plugin).broadcast(op);

        expect(result.txHash).toBe(pad("0xbeef"));
        expect(result.coldStartPayload).toBe("");

        // Input spent; change pending under the same (approved) label → spendable
        // after the next sync: 1000 − 700 − 5 fee.
        const spent = (await plugin.notes(undefined, true)).find(
            (n) => n.commitment === minted.commitment,
        );

        expect(spent?.status).toBe("spent");

        rig.setBlockNumber(101n);

        const balances = await plugin.balance(undefined);

        expect(balances.find((b) => b.tag === "spendable")?.amount).toBe(295n);
    });
});

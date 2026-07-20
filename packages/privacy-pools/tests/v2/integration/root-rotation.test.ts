/**
 * T066 (F4): the ASP association-set root rotates between prepare and execute,
 * over the REAL transfer pipeline (discovery, witness build, broadcast through
 * the shared session). Broadcast re-proves against the ASP's CURRENT root, so
 * the refreshed root genuinely reaches the relayer — asserted from the witness
 * handed to the proof service and validated by the relayer mock. A relayer
 * whose own view lags rejects that proof; the rejection crosses the boundary as
 * a typed `RelayerUnavailableError` (cause preserved), and because inputs are
 * only marked spent on a MINED relay (mine-then-SPENT, C12), the SAME prepared
 * operation re-broadcasts cleanly once the relayer accepts the refreshed root.
 * The on-chain revert itself is contract territory, observed in the manual
 * Sepolia pass (T068).
 */
import type { Address, Hex } from "viem";
import { pad } from "viem";
import { describe, expect, it } from "vitest";
import { persistRevocableKeyIndex } from "../../../src/v2/account/keystore-record";
import { KohakuStorageService } from "../../../src/v2/adapters/storage.adapter";
import { RelayerUnavailableError } from "../../../src/v2/interfaces/errors";
import type {
    PPv2AccountId,
    PPv2PluginParameters,
} from "../../../src/v2/interfaces/plugin.interface";
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
const RECIPIENT = "0x00000000000000000000000000000000000000bb" as PPv2AccountId;
const CHAIN_ID = 11155111n;

describe("ASP root rotation between prepare and execute (T066/F4)", () => {
    it("re-proves against the rotated root at broadcast; a lagging relayer rejects typed, then the same op relays", async () => {
        const asp = createMockAsp();

        // Proof service that records the association root of every witness it
        // proves — the root the relayer is subsequently handed.
        const provenRoots: Hex[] = [];
        const baseProof = createMockProofService();
        const proofService: typeof baseProof = {
            ...baseProof,
            async proveTransact(witness, nInputs, mOutputs) {
                provenRoots.push((witness as { associationSetRoot: Hex }).associationSetRoot);

                return baseProof.proveTransact(witness, nInputs, mOutputs);
            },
        };

        // Relayer that VALIDATES the proof's root against its own current view
        // (a real relayer rejects proofs built on a root it no longer accepts).
        let relayerRootView: Hex | undefined;
        const rootsSeenByRelayer: Hex[] = [];
        const baseRelayer = createMockRelayer({ feeAmount: 5n });
        const relayer: typeof baseRelayer = {
            ...baseRelayer,
            async relayTransfer(...args: never[]) {
                const provenRoot = provenRoots[provenRoots.length - 1] as Hex;

                rootsSeenByRelayer.push(provenRoot);

                if (provenRoot !== relayerRootView) {
                    const e = new Error("proof verified against a rotated ASP root");

                    e.name = "RelayerRejected";
                    throw e;
                }

                return (baseRelayer.relayTransfer as (...a: never[]) => Promise<Hex>)(...args);
            },
        };

        // Full transfer rig: one discovered 1000-wei note with witness fixtures.
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
                proofService,
                entrypointInteractor: createMockEntrypoint(),
            },
        };
        const plugin = await createPPv2Plugin(rig.host, pluginParams);

        asp.associationLeaves.push(minted.labelHash);

        // Prepare against the initial association set: the prepare-time witness
        // embeds the root the SDK builds locally from the ASP's leaves.
        const op = await plugin.prepareTransfer(
            { asset: { __type: "native" }, amount: 700n },
            RECIPIENT,
        );

        const rootAtPrepare = provenRoots[0] as Hex;

        expect(rootAtPrepare).toBeDefined();
        relayerRootView = rootAtPrepare;

        // The ASP rotates its association set between prepare and execute: a new
        // label enters the set, so the locally-built association root changes.
        asp.associationLeaves.push(pad("0x0f00d") as Hex);

        // Broadcast re-proves against the CURRENT (rotated) set — but this
        // relayer's own view still lags at the prepare-time root, so it rejects:
        // typed error, original cause kept, nothing marked spent (mine-then-SPENT).
        const broadcaster = createPPv2Broadcaster(plugin);
        const failure = await broadcaster.broadcast(op).catch((e: unknown) => e);

        expect(failure).toBeInstanceOf(RelayerUnavailableError);
        expect((failure as RelayerUnavailableError).cause).toMatchObject({
            name: "RelayerRejected",
        });

        // The proof that reached the relayer was genuinely refreshed: built on
        // the ROTATED root, not the one from prepare time.
        const rotatedRoot = rootsSeenByRelayer[0] as Hex;

        expect(rotatedRoot).not.toBe(rootAtPrepare);

        const notes = await plugin.notes(undefined, true);

        expect(notes.find((n) => n.commitment === minted.commitment)?.status).toBe("active");

        // The relayer resyncs to the rotated root; the wallet's retry is simply
        // re-broadcasting the SAME operation — the fresh proof carries it too.
        relayerRootView = rotatedRoot;

        const result = await broadcaster.broadcast(op);

        expect(result.txHash).toBe(pad("0xbeef"));
        expect(rootsSeenByRelayer[1]).toBe(rotatedRoot);
    });
});

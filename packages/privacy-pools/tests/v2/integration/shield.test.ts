/**
 * US1 deposit integration (T029/T030) + T034 marker lifecycle + T032 phantom purge.
 *
 * Runs the REAL SDK deposit pipeline offline — note computation (Poseidon), witness
 * preparation, ASP-ciphertext ECDH encryption — through `createPPv2Plugin` with the
 * T027 fixtures injected via `PPv2Factories` (mock proof service, entrypoint, ASP,
 * relayer). Only proving, chain reads, and HTTP are mocked.
 */
import type { Address } from "viem";
import { describe, expect, it } from "vitest";
import type { PPv2AssetAmount, PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { createPPv2Plugin } from "../../../src/v2/plugin";
import { createMockHost } from "../utils/mock-host";
import {
    createMockAsp,
    createMockEntrypoint,
    createMockProofService,
    createMockRelayer,
} from "../utils/mock-services";

const OWNER = "0x00000000000000000000000000000000000000aa" as Address;
/** Native-asset amount shorthand. */
const native = (amount: bigint): PPv2AssetAmount => ({ asset: { __type: "native" }, amount });
const ERC20 = "0x1111111111111111111111111111111111111111" as Address;

/** Offline plugin params; `allowance` steers the mock entrypoint's approve path. */
function params(overrides: { allowance?: bigint } = {}): PPv2PluginParameters {
    return {
        chainId: 11155111n,
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
            aspClient: createMockAsp(),
            relayerInteractor: createMockRelayer(),
            proofService: createMockProofService(),
            entrypointInteractor: createMockEntrypoint(overrides),
        },
    };
}

describe("US1 shield integration (real SDK pipeline, mocked seams)", () => {
    it("native deposit returns deposit TxData with msgValue; plugin sends nothing (T029)", async () => {
        const { host } = createMockHost();
        const plugin = await createPPv2Plugin(host, params());

        const op = await plugin.prepareShield(native(1000n));

        expect(op.__type).toBe("publicOperation");
        expect(op.txs).toHaveLength(1); // native: no approve
        expect(op.txs[0]?.data).toBe("0xde9051");
        expect(op.txs[0]?.value).toBe(1000n); // vettingFee 0 → msgValue = value
    });

    it("ERC20 deposit prepends approve when allowance is insufficient (T030)", async () => {
        const { host } = createMockHost();
        const plugin = await createPPv2Plugin(host, params({ allowance: 0n }));

        const op = await plugin.prepareShield({
            asset: { __type: "erc20", contract: ERC20 },
            amount: 500n,
        });

        expect(op.txs).toHaveLength(2);
        expect(op.txs[0]?.to.toLowerCase()).toBe(ERC20.toLowerCase()); // approve first
        expect(op.txs[1]?.data).toBe("0xde9051");
        expect(op.txs[1]?.value).toBe(0n); // ERC20: msgValue 0
    });

    it("ERC20 deposit skips approve when allowance suffices (T030)", async () => {
        const { host } = createMockHost();
        const plugin = await createPPv2Plugin(host, params({ allowance: 10n ** 30n }));

        const op = await plugin.prepareShield({
            asset: { __type: "erc20", contract: ERC20 },
            amount: 500n,
        });

        expect(op.txs).toHaveLength(1);
    });

    it("persists nothing at prepare time — the note arrives via sync discovery (C16)", async () => {
        const { host, storage } = createMockHost();
        const plugin = await createPPv2Plugin(host, params());
        const keysBefore = new Set(storage.map.keys());

        await plugin.prepareShield(native(1000n));

        // No note state written by prepare: balance stays empty until the deposit
        // mines and discoverNotes finds the on-chain event (INV-2 — storage is a
        // cache of chain state; the wallet owns pre-mine visibility).
        expect([...storage.map.keys()]).toEqual([...keysBefore]);
        const balances = await plugin.balance(undefined);

        expect(balances).toHaveLength(0);
        expect(await plugin.notes()).toHaveLength(0);

        // Explicit sync (incl. phantom purge) is likewise a no-op — nothing to purge.
        await expect(plugin.sync()).resolves.toBeUndefined();
    });
});

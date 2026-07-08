import type { INoteManager, PoolSession, PrepareDepositResult } from "@privacy-pools-v2/sdk";
import { numberToHex, pad } from "viem";
import { describe, expect, it, vi } from "vitest";
import { NotImplementedError } from "../../../src/v2/interfaces/errors";
import type { PPv2AssetAmount, PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { PPv2Plugin } from "../../../src/v2/plugin";

const OWNER = "0x00000000000000000000000000000000000000aa" as const;
const ERC20 = "0x1111111111111111111111111111111111111111" as const;
const ENTRYPOINT = "0x2222222222222222222222222222222222222222" as const;

function pluginWithDeposit(result: PrepareDepositResult) {
    const prepareDeposit = vi.fn(async () => result);
    const session = {
        prepareDeposit,
        discoverNotes: vi.fn(async () => []),
        purgePhantomNotes: vi.fn(async () => []),
    } as unknown as PoolSession;
    const noteManager = { getNotes: () => [] } as unknown as INoteManager;
    const params = { ownerAddress: OWNER } as unknown as PPv2PluginParameters;

    return { plugin: new PPv2Plugin({ session, noteManager, params }), prepareDeposit };
}

const native: PPv2AssetAmount = { asset: { __type: "native" }, amount: 1000n };
const erc20: PPv2AssetAmount = { asset: { __type: "erc20", contract: ERC20 }, amount: 500n };

describe("PPv2Plugin.prepareShield", () => {
    it("native deposit: single tx with msgValue, no approve (US1 AC1)", async () => {
        const { plugin } = pluginWithDeposit({
            pendingNote: {} as PrepareDepositResult["pendingNote"],
            callData: "0xdeadbeef",
            to: ENTRYPOINT,
            msgValue: numberToHex(1000n),
            approvalTx: null,
        });

        const op = await plugin.prepareShield(native);

        expect(op.__type).toBe("publicOperation");
        expect(op.txs).toHaveLength(1);
        expect(op.txs[0]).toEqual({ to: ENTRYPOINT, data: "0xdeadbeef", value: 1000n });
    });

    it("ERC20 deposit: approve is prepended before deposit (US1 AC2)", async () => {
        const { plugin } = pluginWithDeposit({
            pendingNote: {} as PrepareDepositResult["pendingNote"],
            callData: "0xdep0517",
            to: ENTRYPOINT,
            msgValue: "0x0",
            approvalTx: { to: ERC20, data: "0x095ea7b3", value: "0x0" },
        });

        const op = await plugin.prepareShield(erc20);

        expect(op.txs).toHaveLength(2);
        expect(op.txs[0]).toEqual({ to: ERC20, data: "0x095ea7b3", value: 0n }); // approve first
        expect(op.txs[1]).toEqual({ to: ENTRYPOINT, data: "0xdep0517", value: 0n });
    });

    it("ERC20 with sufficient allowance: no approve tx (US1 AC2)", async () => {
        const { plugin } = pluginWithDeposit({
            pendingNote: {} as PrepareDepositResult["pendingNote"],
            callData: "0xdep",
            to: ENTRYPOINT,
            msgValue: "0x0",
            approvalTx: null,
        });

        const op = await plugin.prepareShield(erc20);

        expect(op.txs).toHaveLength(1);
    });

    it("passes the mapped tokenId and hex value to the SDK", async () => {
        const { plugin, prepareDeposit } = pluginWithDeposit({
            pendingNote: {} as PrepareDepositResult["pendingNote"],
            callData: "0x",
            to: ENTRYPOINT,
            msgValue: numberToHex(1000n),
            approvalTx: null,
        });

        await plugin.prepareShield(native);
        expect(prepareDeposit).toHaveBeenCalledWith({
            tokenId: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            value: pad("0x3e8"), // 1000, left-padded to 32 bytes
        });
    });

    it("deposit-for (to provided) is a deferred follow-up", async () => {
        const { plugin } = pluginWithDeposit({
            pendingNote: {} as PrepareDepositResult["pendingNote"],
            callData: "0x",
            to: ENTRYPOINT,
            msgValue: "0x0",
            approvalTx: null,
        });

        await expect(plugin.prepareShield(native, OWNER)).rejects.toBeInstanceOf(
            NotImplementedError,
        );
    });
});

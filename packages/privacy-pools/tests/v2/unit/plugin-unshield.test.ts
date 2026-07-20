import { InsufficientBalanceError } from "@kohaku-eth/plugins";
import type {
    INoteManager,
    Note,
    PoolSession,
    PrepareWithdrawRelayerQuotes,
    PrepareWithdrawResult,
} from "@0xbow-io/privacy-pools-v2-sdk";
import { NoteStatus } from "@0xbow-io/privacy-pools-v2-sdk";
import { numberToHex, pad } from "viem";
import { describe, expect, it, vi } from "vitest";
import {
    LabelFragmentationError,
    NotImplementedError,
    NotRegisteredError,
    RelayerUnavailableError,
} from "../../../src/v2/interfaces/errors";
import type { PPv2AssetAmount, PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { PPv2Plugin } from "../../../src/v2/plugin";

const OWNER = "0x00000000000000000000000000000000000000aa" as const;
const RECIPIENT = "0x00000000000000000000000000000000000000cc" as const;
const TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const; // native
const LABEL = pad("0x0a") as `0x${string}`;

const FUTURE = Math.floor(Date.now() / 1000) + 3600;
const PAST = Math.floor(Date.now() / 1000) - 10;

let seq = 100;

/** ACTIVE native-token note fixture with a unique commitment. */
function activeNote(value: bigint): Note {
    seq += 1;

    return {
        commitment: pad(numberToHex(seq)),
        noteAddressHash: pad("0x01"),
        value: numberToHex(value, { size: 32 }),
        tokenId: TOKEN,
        label: LABEL,
        status: NoteStatus.ACTIVE,
        createdAtBlock: numberToHex(seq),
        spentAtBlock: null,
        txHash: pad("0xab"),
    } as unknown as Note;
}

/** Relayer withdrawal quote with the given fee and fee-commitment expiry. */
function withdrawQuote(name: string, feeAmount: bigint, expiration: number): PrepareWithdrawRelayerQuotes {
    return {
        relayerInfo: {
            url: `https://${name}.example`,
            name,
            chainId: 11155111,
            chainType: "evm",
            status: "active",
            address: pad(`0x${name}`),
            processorAddress: pad(`0x${name}fe`),
        },
        quote: {
            txCost: "0",
            gasPrice: "0",
            feeAmount: feeAmount.toString(),
            amountSent: "0",
            amountReceived: "0",
            feeCommitment: {
                data: "0x",
                asset: TOKEN,
                expiration,
                feeAmount: feeAmount.toString(),
                signedRelayerCommitment: "0x",
                recipient: RECIPIENT,
                amountSent: "0",
                amountReceived: "0",
                extraGas: false,
            },
        },
    } as unknown as PrepareWithdrawRelayerQuotes;
}

/** Plugin over fixed notes whose prepareWithdraw echoes the given quotes. */
function makePlugin(opts: {
    notes: Note[];
    quotes: PrepareWithdrawRelayerQuotes[];
    registered?: boolean;
    onPrepare?: (params: unknown) => void;
}) {
    const prepareWithdraw = vi.fn(
        async (params: { inputCommitments: `0x${string}`[] }): Promise<PrepareWithdrawResult> => {
            opts.onPrepare?.(params);

            return {
                changePendingNotes: [],
                callData: "0x",
                to: pad("0x99"),
                spentNotes: [],
                relayerOptions: opts.quotes.map(
                    (q) =>
                        ({
                            inputCommitments: params.inputCommitments,
                            selectedQuote: q,
                        }) as never,
                ),
            } as unknown as PrepareWithdrawResult;
        },
    );
    const session = {
        discoverNotes: vi.fn(async () => []),
        purgePhantomNotes: vi.fn(async () => []),
        isKeystoreRegistered: vi.fn(async () => opts.registered ?? true),
        prepareWithdraw,
    } as unknown as PoolSession;
    const noteManager = { getNotes: () => opts.notes } as unknown as INoteManager;
    const params = { chainId: 11155111n, ownerAddress: OWNER } as unknown as PPv2PluginParameters;

    return { plugin: new PPv2Plugin({ session, noteManager, params }), prepareWithdraw };
}

/** Native-asset amount shorthand. */
const asset = (amount: bigint): PPv2AssetAmount => ({ asset: { __type: "native" }, amount });

describe("PPv2Plugin.prepareUnshield", () => {
    it("throws NotRegistered when the account is unregistered (INV-8)", async () => {
        const { plugin } = makePlugin({
            notes: [activeNote(1000n)],
            quotes: [withdrawQuote("11", 5n, FUTURE)],
            registered: false,
        });

        await expect(plugin.prepareUnshield(asset(100n), RECIPIENT)).rejects.toBeInstanceOf(
            NotRegisteredError,
        );
    });

    it("throws InsufficientBalance before proving when amount exceeds spendable (US3 AC-3)", async () => {
        const { plugin, prepareWithdraw } = makePlugin({
            notes: [activeNote(50n)],
            quotes: [withdrawQuote("11", 5n, FUTURE)],
        });

        await expect(plugin.prepareUnshield(asset(100n), RECIPIENT)).rejects.toBeInstanceOf(
            InsufficientBalanceError,
        );
        expect(prepareWithdraw).not.toHaveBeenCalled();
    });

    it("prepares a withdrawal op with the cheapest live affordable relayer option", async () => {
        let captured: { inputCommitments: string[]; amount: string; recipientAddress: string } | undefined;
        const { plugin } = makePlugin({
            notes: [activeNote(500n)],
            quotes: [
                withdrawQuote("11", 50n, FUTURE),
                withdrawQuote("22", 9n, FUTURE),
                withdrawQuote("33", 9000n, FUTURE), // unaffordable: fee > total - amount
            ],
            onPrepare: (p) => {
                captured = p as typeof captured;
            },
        });

        const op = await plugin.prepareUnshield(asset(100n), RECIPIENT);

        expect(op.kind).toBe("withdrawal");
        expect(op.__type).toBe("privateOperation");
        expect(captured?.amount).toBe(numberToHex(100n, { size: 32 }));
        expect(captured?.recipientAddress).toBe(RECIPIENT);
        const chosen = op as unknown as {
            relayParams: { selectedQuote: { quote: { feeAmount: string } } };
        };

        expect(chosen.relayParams.selectedQuote.quote.feeAmount).toBe("9");
    });

    it("throws RelayerUnavailable when no quote is live", async () => {
        const { plugin } = makePlugin({
            notes: [activeNote(1000n)],
            quotes: [withdrawQuote("11", 5n, PAST)],
        });

        await expect(plugin.prepareUnshield(asset(100n), RECIPIENT)).rejects.toBeInstanceOf(
            RelayerUnavailableError,
        );
    });

    it("throws LabelFragmentation when no live fee fits amount + fee", async () => {
        // 101 covers amount 100 but the only live fee (50) exceeds total - amount (1)
        const { plugin } = makePlugin({
            notes: [activeNote(101n)],
            quotes: [withdrawQuote("11", 50n, FUTURE)],
        });

        await expect(plugin.prepareUnshield(asset(100n), RECIPIENT)).rejects.toBeInstanceOf(
            LabelFragmentationError,
        );
    });

    it("rejects tailCalls (relayer path can't append wallet calls)", async () => {
        const { plugin } = makePlugin({
            notes: [activeNote(1000n)],
            quotes: [withdrawQuote("11", 5n, FUTURE)],
        });

        await expect(
            plugin.prepareUnshield(asset(100n), RECIPIENT, { tailCalls: async () => [] }),
        ).rejects.toBeInstanceOf(NotImplementedError);
    });
});

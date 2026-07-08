import type {
    INoteManager,
    Note,
    PoolSession,
    PrepareTransferRelayerQuotes,
    PrepareTransferResult,
} from "@privacy-pools-v2/sdk";
import { NoteStatus } from "@privacy-pools-v2/sdk";
import { numberToHex, pad } from "viem";
import { describe, expect, it, vi } from "vitest";
import { LabelFragmentationError, NotRegisteredError, RelayerUnavailableError } from "../../../src/v2/interfaces/errors";
import type { PPv2AssetAmount, PPv2PluginParameters } from "../../../src/v2/interfaces/plugin.interface";
import { PPv2Plugin } from "../../../src/v2/plugin";

const OWNER = "0x00000000000000000000000000000000000000aa" as const;
const RECIPIENT = "0x00000000000000000000000000000000000000bb" as const;
const TOKEN = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" as const; // native
const LABEL = pad("0x0a") as `0x${string}`;

let seq = 0;

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

function quote(relayer: string, feeAmount: bigint, expiration: number): PrepareTransferRelayerQuotes {
    return {
        relayerInfo: {
            url: `https://${relayer}.example`,
            name: relayer,
            chainId: 11155111,
            chainType: "evm",
            status: "active",
            address: pad(`0x${relayer}`),
            processorAddress: pad(`0x${relayer}fe`),
        },
        quote: {
            txCost: "0",
            gasPrice: "0",
            feeAmount: feeAmount.toString(),
            feeCommitment: {
                data: "0x",
                asset: TOKEN,
                expiration,
                feeAmount: feeAmount.toString(),
                signedRelayerCommitment: "0x",
            },
        },
    } as unknown as PrepareTransferRelayerQuotes;
}

const FUTURE = Math.floor(Date.now() / 1000) + 3600;

function makePlugin(opts: {
    notes: Note[];
    quotes: PrepareTransferRelayerQuotes[];
    registered?: boolean;
    onPrepare?: (params: unknown) => void;
}) {
    const prepareColdStartTransfer = vi.fn(
        async (params: { inputCommitments: `0x${string}`[] }): Promise<PrepareTransferResult> => {
            opts.onPrepare?.(params);

            return {
                executeOptions: {} as PrepareTransferResult["executeOptions"],
                // one relay option per quote, echoing the quote as selectedQuote
                relayOptions: opts.quotes.map(
                    (q) => ({ inputCommitments: params.inputCommitments, selectedQuote: q }) as never,
                ),
            };
        },
    );
    const session = {
        discoverNotes: vi.fn(async () => []),
        purgePhantomNotes: vi.fn(async () => []),
        isKeystoreRegistered: vi.fn(async () => opts.registered ?? true),
        prepareColdStartTransfer,
    } as unknown as PoolSession;
    const noteManager = { getNotes: () => opts.notes } as unknown as INoteManager;
    const params = { chainId: 11155111n, ownerAddress: OWNER } as unknown as PPv2PluginParameters;

    return {
        plugin: new PPv2Plugin({ session, noteManager, params }),
        prepareColdStartTransfer,
    };
}

const asset = (amount: bigint): PPv2AssetAmount => ({ asset: { __type: "native" }, amount });

describe("PPv2Plugin.prepareTransfer", () => {
    it("throws NotRegistered when the account is unregistered (INV-8)", async () => {
        const { plugin } = makePlugin({ notes: [], quotes: [quote("11", 5n, FUTURE)], registered: false });

        await expect(plugin.prepareTransfer(asset(100n), RECIPIENT)).rejects.toBeInstanceOf(
            NotRegisteredError,
        );
    });

    it("selects inputs covering amount + fee and returns a transfer op", async () => {
        let captured: { inputCommitments: string[]; amount: string; feeAmount?: string } | undefined;
        const notes = [activeNote(80n), activeNote(80n)]; // 160 total; amount 100 + fee 5 = 105
        const { plugin } = makePlugin({
            notes,
            quotes: [quote("11", 5n, FUTURE)],
            onPrepare: (p) => {
                captured = p as typeof captured;
            },
        });

        const op = await plugin.prepareTransfer(asset(100n), RECIPIENT);

        expect(op.kind).toBe("transfer");
        expect(op.__type).toBe("privateOperation");
        expect(captured?.amount).toBe(numberToHex(100n, { size: 32 }));
        // feeAmount/relayAddress/processorAddress are NOT passed — the SDK derives them.
        expect(captured?.feeAmount).toBeUndefined();
        // both notes needed to cover amount + fee (105)
        expect(captured?.inputCommitments).toHaveLength(2);
    });

    it("picks the cheapest live relay option", async () => {
        const { plugin } = makePlugin({
            notes: [activeNote(1000n)],
            quotes: [quote("11", 50n, FUTURE), quote("22", 9n, FUTURE), quote("33", 20n, FUTURE)],
        });

        const op = await plugin.prepareTransfer(asset(100n), RECIPIENT);
        const chosen = op as unknown as {
            relayParams: { selectedQuote: { quote: { feeAmount: string } } };
        };

        expect(chosen.relayParams.selectedQuote.quote.feeAmount).toBe("9");
    });

    it("throws RelayerUnavailable when no quote is live", async () => {
        const past = Math.floor(Date.now() / 1000) - 10;
        const { plugin } = makePlugin({ notes: [activeNote(1000n)], quotes: [quote("11", 5n, past)] });

        await expect(plugin.prepareTransfer(asset(100n), RECIPIENT)).rejects.toBeInstanceOf(
            RelayerUnavailableError,
        );
    });

    it("throws LabelFragmentation when the 4 largest can't cover the amount", async () => {
        const { plugin } = makePlugin({ notes: [activeNote(50n)], quotes: [quote("11", 5n, FUTURE)] });

        await expect(plugin.prepareTransfer(asset(100n), RECIPIENT)).rejects.toBeInstanceOf(
            LabelFragmentationError,
        );
    });

    it("throws LabelFragmentation when change can't cover the fee (amount+fee)", async () => {
        // 101 covers amount 100 (change 1) but the fee (50) exceeds the change
        const { plugin } = makePlugin({ notes: [activeNote(101n)], quotes: [quote("11", 50n, FUTURE)] });

        await expect(plugin.prepareTransfer(asset(100n), RECIPIENT)).rejects.toBeInstanceOf(
            LabelFragmentationError,
        );
    });
});

import type { EthereumProvider } from "@kohaku-eth/provider";
import {
    type AbiEvent,
    encodeAbiParameters,
    numberToHex,
    pad,
    toEventSelector,
    toHex,
} from "viem";
import { describe, expect, it, vi } from "vitest";
import { KohakuRpcInteractor } from "../../../src/v2/adapters/rpc.adapter";

const balanceOfAbi = [
    {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ type: "uint256" }],
    },
] as const;

const transferEvent = {
    name: "Transfer",
    type: "event",
    inputs: [
        { name: "from", type: "address", indexed: true },
        { name: "to", type: "address", indexed: true },
        { name: "value", type: "uint256", indexed: false },
    ],
} as const satisfies AbiEvent;

const ADDR = "0x1111111111111111111111111111111111111111" as const;
const FROM = "0x2222222222222222222222222222222222222222" as const;
const TO = "0x3333333333333333333333333333333333333333" as const;

function mockProvider(request: (m: string, p: unknown[]) => unknown): EthereumProvider {
    return {
        request: vi.fn(async (r: { method: string; params?: unknown[] }) =>
            request(r.method, (r.params ?? []) as unknown[]),
        ),
        getBlockNumber: vi.fn(async () => 123n),
        waitForTransaction: vi.fn(async () => undefined),
    } as unknown as EthereumProvider;
}

describe("KohakuRpcInteractor", () => {
    it("readContract encodes the call and decodes the result", async () => {
        const rpc = new KohakuRpcInteractor(
            mockProvider((method) => {
                expect(method).toBe("eth_call");

                return numberToHex(1000n, { size: 32 });
            }),
        );
        const result = await rpc.readContract({
            address: ADDR,
            abi: balanceOfAbi as never,
            functionName: "balanceOf",
            args: [ADDR],
        });

        expect(result).toBe(1000n);
    });

    it("getBlockNumber returns hex", async () => {
        const rpc = new KohakuRpcInteractor(mockProvider(() => undefined));

        expect(await rpc.getBlockNumber()).toBe(numberToHex(123n));
    });

    it("getLogs filters by event selector and decodes args", async () => {
        const rawLog = {
            address: ADDR,
            topics: [toEventSelector(transferEvent), pad(FROM), pad(TO)],
            data: encodeAbiParameters([{ type: "uint256" }], [777n]),
            blockNumber: numberToHex(50n),
            transactionHash: pad("0xabcd"),
            logIndex: toHex(2),
        };
        const rpc = new KohakuRpcInteractor(
            mockProvider((method, params) => {
                expect(method).toBe("eth_getLogs");
                const filter = params[0] as { topics: unknown[] };

                expect(filter.topics[0]).toEqual([toEventSelector(transferEvent)]);

                return [rawLog];
            }),
        );

        const logs = await rpc.getLogs({
            address: ADDR,
            events: [transferEvent] as never,
            fromBlock: 0n,
            toBlock: 100n,
        });

        expect(logs).toHaveLength(1);
        expect(logs[0]?.eventName).toBe("Transfer");
        expect(logs[0]?.args.value).toBe(777n);
        expect(logs[0]?.blockNumber).toBe(numberToHex(50n));
        expect(logs[0]?.transactionHash).toBe(pad("0xabcd"));
    });

    it("waitForTransactionReceipt maps a raw receipt", async () => {
        const rpc = new KohakuRpcInteractor(
            mockProvider((method) => {
                if (method === "eth_getTransactionReceipt") {
                    return {
                        status: "0x1",
                        blockNumber: numberToHex(9n),
                        logs: [],
                    };
                }

                return undefined;
            }),
        );
        const receipt = await rpc.waitForTransactionReceipt(pad("0xdead"));

        expect(receipt.status).toBe(true);
        expect(receipt.blockNumber).toBe(numberToHex(9n));
        expect(receipt.txHash).toBe(pad("0xdead"));
    });
});

import { describe, expect, test } from "vitest";
import {
    buildUnshieldExecutionCalls,
    toHexQuantity,
    txDataToCall,
} from "../sdk/unshield-calls.js";

const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" as const;
const AA = "0x1111111111111111111111111111111111111111" as const;
const TOKEN = "0x2222222222222222222222222222222222222222" as const;

describe("toHexQuantity", () => {
    test("encodes zero and nonzero values", () => {
        expect(toHexQuantity(0n)).toBe("0x0");
        expect(toHexQuantity(255n)).toBe("0xff");
        expect(toHexQuantity(1_000n)).toBe("0x3e8");
    });
});

describe("txDataToCall", () => {
    test("maps TxData to wasm Call fields", () => {
        expect(txDataToCall({
            to: TOKEN,
            data: "0xabcdef",
            value: 42n,
        })).toEqual({
            target: TOKEN,
            data: "0xabcdef",
            value: "0x2a",
        });
    });

    test("defaults empty data and zero value", () => {
        expect(txDataToCall({ to: TOKEN, data: "", value: 0n })).toEqual({
            target: TOKEN,
            data: "0x",
            value: "0x0",
        });
    });
});

describe("buildUnshieldExecutionCalls", () => {
    test("empty when no native unwrap and no user tails (ERC-20 path)", () => {
        expect(buildUnshieldExecutionCalls({
            wrappedBaseToken: WETH,
        })).toEqual([]);
    });

    test("native unwrap only when tailCalls omitted (backward compatible)", () => {
        const calls = buildUnshieldExecutionCalls({
            wrappedBaseToken: WETH,
            nativeAmount: 5_000n,
            to: AA,
        });
        expect(calls).toHaveLength(1);
        expect(calls[0]!.target).toBe(WETH);
        expect(calls[0]!.value).toBe("0x0");
        // withdraw(uint256) selector
        expect(calls[0]!.data.startsWith("0x2e1a7d4d")).toBe(true);
        expect(calls[0]!.data.endsWith("1388")).toBe(true); // 5000
    });

    test("native unwrap then user tails (system prefix first)", () => {
        const userTail = {
            target: TOKEN,
            data: "0xdead" as `0x${string}`,
            value: "0x1" as `0x${string}`,
        };
        const calls = buildUnshieldExecutionCalls({
            wrappedBaseToken: WETH,
            nativeAmount: 100n,
            to: AA,
            userTailCalls: [userTail],
        });
        expect(calls).toHaveLength(2);
        expect(calls[0]!.target).toBe(WETH);
        expect(calls[1]).toEqual(userTail);
    });

    test("ERC-20 unshield with user tails only (no unwrap)", () => {
        const userTail = {
            target: TOKEN,
            data: "0xbeef" as `0x${string}`,
            value: "0x0" as `0x${string}`,
        };
        expect(buildUnshieldExecutionCalls({
            wrappedBaseToken: WETH,
            nativeAmount: 0n,
            to: AA,
            userTailCalls: [userTail],
        })).toEqual([userTail]);
    });

    test("throws when nativeAmount set without to", () => {
        expect(() => buildUnshieldExecutionCalls({
            wrappedBaseToken: WETH,
            nativeAmount: 1n,
        })).toThrow(/requires `to`/);
    });
});

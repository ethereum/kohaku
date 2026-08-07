import type { TxData } from "@kohaku-eth/provider";
import { encodeFunctionData } from "viem";

/**
 * Execution-phase call shape expected by railgun-rs `prepareUserOp` /
 * `SimpleSmartAccount::Call` (target / value / data, all hex).
 */
export type ExecutionCall = {
    target: `0x${string}`;
    value: `0x${string}`;
    data: `0x${string}`;
};

/** Encode a bigint as a hex quantity for wasm `U256` fields. */
export function toHexQuantity(value: bigint): `0x${string}` {
    if (value < 0n) {
        throw new Error(`Call value must be non-negative, got ${value}`);
    }
    return `0x${value.toString(16)}`;
}

/**
 * Map plugin `TxData` (`to` / `data` / `value` bigint) → wasm `Call`
 * (`target` / `data` / `value` hex).
 */
export function txDataToCall(tx: TxData): ExecutionCall {
    return {
        target: tx.to as `0x${string}`,
        data: (tx.data || "0x") as `0x${string}`,
        value: toHexQuantity(tx.value ?? 0n),
    };
}

export type BuildUnshieldExecutionCallsParams = {
    wrappedBaseToken: `0x${string}`;
    /** Requested native receive amount; when set with `to`, prepends WETH.withdraw. */
    nativeAmount?: bigint;
    /** Unshield recipient / AA address; required when `nativeAmount` is set. */
    to?: `0x${string}`;
    /** Already-resolved user tail calls (AA execution phase). */
    userTailCalls?: ExecutionCall[];
};

/**
 * Compose Railgun execution-phase calls for unshield broadcast.
 *
 * Ordering (must preserve):
 * 1. Optional system prefix: `WETH.withdraw(nativeAmount)` when unshielding native ETH
 * 2. User `tailCalls` (never replace/drop the unwrap)
 *
 * Unlike Tornado, Railgun already delivers unshielded funds to `to` inside the
 * privacy-paymaster tx — there is no leftover-forward baking here.
 */
export function buildUnshieldExecutionCalls({
    wrappedBaseToken,
    nativeAmount,
    to,
    userTailCalls = [],
}: BuildUnshieldExecutionCallsParams): ExecutionCall[] {
    const calls: ExecutionCall[] = [];

    if (nativeAmount != null && nativeAmount > 0n) {
        if (!to) {
            throw new Error("nativeAmount requires `to` (smart-account address) for WETH unwrap");
        }
        const data = encodeFunctionData({
            abi: [{
                name: "withdraw",
                type: "function",
                inputs: [{ name: "wad", type: "uint256" }],
            }],
            functionName: "withdraw",
            args: [nativeAmount],
        });
        calls.push({
            target: wrappedBaseToken,
            value: "0x0",
            data,
        });
    }

    calls.push(...userTailCalls);
    return calls;
}

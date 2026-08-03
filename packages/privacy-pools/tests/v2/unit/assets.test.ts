import { describe, expect, it } from "vitest";
import {
    amountToHex,
    assetToTokenId,
    hexToAmount,
    sameAsset,
    tokenIdToAsset,
} from "../../../src/v2/mapping/assets";

// SDK native sentinel (mirrored; the SDK 0.0.0 build does not re-export it at runtime).
const NATIVE_ASSET_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ERC20 = "0x1234567890123456789012345678901234567890" as const;

describe("assets mapping", () => {
    it("maps native asset to the SDK native sentinel", () => {
        expect(assetToTokenId({ __type: "native" })).toBe(NATIVE_ASSET_ADDRESS);
    });

    it("maps ERC20 asset to its contract address", () => {
        expect(assetToTokenId({ __type: "erc20", contract: ERC20 }).toLowerCase()).toBe(ERC20);
    });

    it("throws UnsupportedAssetError for erc721", () => {
        expect(() =>
            assetToTokenId({ __type: "erc721", contract: ERC20, tokenId: 1n }),
        ).toThrowError();
    });

    it("round-trips native and erc20 through tokenId", () => {
        expect(tokenIdToAsset(NATIVE_ASSET_ADDRESS)).toEqual({ __type: "native" });
        expect(tokenIdToAsset(assetToTokenId({ __type: "erc20", contract: ERC20 }))).toEqual({
            __type: "erc20",
            contract: ERC20,
        });
    });

    it("round-trips bigint amounts through hex", () => {
        for (const v of [0n, 1n, 1000n, 2n ** 200n]) {
            expect(hexToAmount(amountToHex(v))).toBe(v);
        }
    });

    it("sameAsset compares by on-chain token", () => {
        expect(sameAsset({ __type: "native" }, { __type: "native" })).toBe(true);
        expect(sameAsset({ __type: "native" }, { __type: "erc20", contract: ERC20 })).toBe(false);
    });
});

describe("mirrored SDK constants (DEP-1 drift guards)", () => {
    it("pins the native sentinel and the 32-byte hex convention as canonical vectors", () => {
        // Protocol constants mirrored in src/v2/mapping/assets.ts because the
        // SDK's runtime bundle doesn't export them (d.ts-only). Any local edit
        // must fail here loudly.
        expect(assetToTokenId({ __type: "native" })).toBe(NATIVE_ASSET_ADDRESS);
        expect(amountToHex(0n)).toBe(`0x${"00".repeat(32)}`);
        expect(amountToHex(255n)).toBe(`0x${"00".repeat(31)}ff`);
        expect(amountToHex(2n ** 255n)).toBe(`0x8${"0".repeat(63)}`);
    });

    it("tripwire: compares against the SDK the moment it runtime-exports the originals", async () => {
        const sdk: Record<string, unknown> = await import("@0xbow-io/privacy-pools-v2-sdk");

        // The published beta runtime-exports neither symbol, so both branches
        // are skipped today. When a future SDK version starts exporting them,
        // these assertions go live: a failure means the mirrors in
        // src/v2/mapping/assets.ts diverged — delete them and import for real.
        if (sdk["NATIVE_ASSET_ADDRESS"] !== undefined) {
            expect(sdk["NATIVE_ASSET_ADDRESS"]).toBe(NATIVE_ASSET_ADDRESS);
        }

        if (typeof sdk["bigintToHex"] === "function") {
            const bigintToHex = sdk["bigintToHex"] as (v: bigint) => string;

            for (const v of [0n, 1n, 255n, 2n ** 200n]) {
                expect(amountToHex(v)).toBe(bigintToHex(v));
            }
        }
    });
});

import { NATIVE_ASSET_ADDRESS, bigintToHex } from "@0xbow/privacy-pools-v2-sdk";
import { describe, expect, it } from "vitest";
import {
    amountToHex,
    assetToTokenId,
    hexToAmount,
    sameAsset,
    tokenIdToAsset,
} from "../../../src/v2/mapping/assets";

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
        // Protocol constants: the sentinel address and the left-padded 32-byte
        // hex the SDK encodes amounts in. Any drift must fail here loudly.
        expect(NATIVE_ASSET_ADDRESS).toBe("0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE");
        expect(amountToHex(0n)).toBe(`0x${"00".repeat(32)}`);
        expect(amountToHex(255n)).toBe(`0x${"00".repeat(31)}ff`);
        expect(amountToHex(2n ** 255n)).toBe(`0x8${"0".repeat(63)}`);
    });

    it("amount encoding is the SDK's own bigintToHex", () => {
        for (const v of [0n, 1n, 255n, 2n ** 200n]) {
            expect(amountToHex(v)).toBe(bigintToHex(v));
        }
    });
});

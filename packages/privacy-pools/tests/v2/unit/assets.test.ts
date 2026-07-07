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
            contract: expect.stringMatching(/^0x1234/i),
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

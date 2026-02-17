import { Address } from "ox/Address";

export type AssetId = `erc20:${Address}`;
export type ChainId = `eip155:${bigint}`;
export type AccountId = Address;

export type AssetAmount<TAssetId extends string = AssetId, TAmount extends bigint = bigint> = {
    asset: TAssetId;
    amount: TAmount;
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Kind<TKind extends string, TData extends object = {}> = {
    __type: TKind;
} & TData;

export type PrivateOperation = Kind<"privateOperation">;
export type PublicOperation = Kind<"publicOperation">;

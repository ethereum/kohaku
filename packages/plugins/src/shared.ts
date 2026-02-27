import { Address } from "ox/Address";

export type ERC20AssetId = {
    __type: 'erc20'
    contract: Address;
};
export type ERC721AssetId = {
    __type: 'erc721'
    contract: Address;
    tokenId: bigint;
};
export type AssetId = ERC20AssetId | ERC721AssetId;

export type ChainId = bigint;
export type AccountId = Address;

export type AssetAmount<TAssetId = AssetId, TAmount extends bigint = bigint, TTag extends string | undefined = string> = {
    asset: TAssetId;
    amount: TAmount;
    tag?: TTag;
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Kind<TKind extends string, TData extends object = {}> = {
    __type: TKind;
} & TData;

export type PrivateOperation = Kind<"privateOperation">;
export type PublicOperation = Kind<"publicOperation">;

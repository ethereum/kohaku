import { AssetAmount, AssetId, PrivateOperation, PublicOperation } from "~/shared";
/* eslint-disable @typescript-eslint/no-empty-object-type */
import { Address } from "ox/Address";

export type AssetAmounts<
    TxAssetAmountInput extends AssetAmount = AssetAmount,
    TxAssetAmountInternal extends AssetAmount = AssetAmount,
    TxAssetAmountOutput extends AssetAmount = AssetAmount,
> = {
    input: TxAssetAmountInput;
    internal: TxAssetAmountInternal;
    output: TxAssetAmountOutput;
}

export type TxFeatureMap<
    TAccountId extends string = string,
    TAssetAmounts extends AssetAmounts = AssetAmounts,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
> = {
    shield: (asset: TAssetAmounts['input'], to: TAccountId) => Promise<PublicOperation>;
    shieldMulti: (assets: Array<AssetAmount>, to: TAccountId) => Promise<PublicOperation>;
    transfer: (asset: TAssetAmounts['internal'], to: TAccountId) => Promise<TPrivateOperation>;
    transferMulti: (assets: Array<TAssetAmounts['internal']>, to: TAccountId) => Promise<TPrivateOperation>;
    unshield: (asset: TAssetAmounts['output'], to: Address) => Promise<TPrivateOperation>;
    unshieldMulti: (assets: Array<AssetAmount>, to: Address) => Promise<TPrivateOperation>;
};

type EnabledKeys<
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Features extends Record<string, any>,
    Flags extends Partial<Record<keyof Features, boolean>>,
> = {
    [K in keyof Features]-?: Flags[K] extends true ? K : never
}[keyof Features];

export type TxFeatures<TAccountId extends string = string, TAssetAmounts extends AssetAmounts = AssetAmounts, TPrivateOperation extends PrivateOperation = PrivateOperation> = Partial<Record<keyof TxFeatureMap<TAccountId, TAssetAmounts, TPrivateOperation>, boolean>>;

export type Transact<
    TAccountId extends string = string,
    TAssetAmounts extends AssetAmounts = AssetAmounts,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
    AvailableFeatures extends TxFeatures<TAccountId, TAssetAmounts, TPrivateOperation> = {},
> = Pick<TxFeatureMap<TAccountId, TAssetAmounts, TPrivateOperation>, EnabledKeys<TxFeatureMap<TAccountId, TAssetAmounts, TPrivateOperation>, AvailableFeatures>>;

export type Instance<
    TAccountId extends string = string,
    TAssetAmounts extends AssetAmounts = AssetAmounts,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
    TransactionFeatures extends TxFeatures<TAccountId, TAssetAmounts, TPrivateOperation> = TxFeatures<TAccountId, TAssetAmounts, TPrivateOperation>,
> = {
    account: () => Promise<TAccountId>;
    balance: (assets: Array<AssetId> | undefined) => Promise<Array<AssetAmount>>;
} & Transact<TAccountId, TAssetAmounts, TPrivateOperation, TransactionFeatures>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyInstance = Instance<any, any, any>;

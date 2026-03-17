/* eslint-disable @typescript-eslint/no-explicit-any */
import { Host } from "~/host";
import { AssetAmount, PrivateOperation, PublicOperation } from "~/shared";
import { Address } from "ox/Address";

export type AssetAmounts<
    TxAssetAmountInput extends AssetAmount = AssetAmount,
    TxAssetAmountInternal extends AssetAmount = AssetAmount,
    TxAssetAmountOutput extends AssetAmount = AssetAmount,
    TxAssetAmountRead extends AssetAmount = AssetAmount,
> = {
    input: TxAssetAmountInput;
    internal: TxAssetAmountInternal;
    output: TxAssetAmountOutput;
    read: TxAssetAmountRead;
}

export type TxFeatureMap<
    TAccountId extends string,
    TAssetAmounts extends AssetAmounts,
    TPrivateOperation extends PrivateOperation,
    TPublicOperation extends PublicOperation,
> = {
    prepareShield(asset: TAssetAmounts['input'], to?: TAccountId): Promise<TPublicOperation>;
    prepareShieldMulti(assets: Array<AssetAmount>, to?: TAccountId): Promise<TPublicOperation>;
    prepareTransfer(asset: TAssetAmounts['internal'], to: TAccountId): Promise<TPrivateOperation>;
    prepareTransferMulti(assets: Array<TAssetAmounts['internal']>, to: TAccountId): Promise<TPrivateOperation>;
    prepareUnshield(asset: TAssetAmounts['output'], to: Address): Promise<TPrivateOperation>;
    prepareUnshieldMulti(assets: Array<AssetAmount>, to: Address): Promise<TPrivateOperation>;
};

type EnabledKeys<
    Features extends Record<string, unknown>,
    Flags extends Partial<Record<keyof Features, boolean>>,
> = {
    [K in keyof Features]-?: Flags[K] extends true ? K : never
}[keyof Features];

export type TxFeatures<
    TAccountId extends string = string,
    TAssetAmounts extends AssetAmounts = AssetAmounts,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
    TPublicOperation extends PublicOperation = PublicOperation,
> = Partial<Record<keyof TxFeatureMap<TAccountId, TAssetAmounts, TPrivateOperation, TPublicOperation>, boolean>>;

export type PICapabilities = {
    credential: unknown;
    features: TxFeatures;
    privateOp: PrivateOperation;
    publicOp: PublicOperation;
    assetAmounts: AssetAmounts;
    extras: Record<string, unknown>;
};

export type PICapCfg<T extends Partial<PICapabilities> = object> = {
    [key in keyof PICapabilities]: undefined extends T[key] ? PICapabilities[key] : T[key];
};
export type Transact<
    TAccountId extends string,
    C extends PICapabilities
> = Pick<TxFeatureMap<TAccountId, C['assetAmounts'], C['privateOp'], C['publicOp']>, EnabledKeys<TxFeatureMap<TAccountId, C['assetAmounts'], C['privateOp'], C['publicOp']>, C['features']>> & {
    balance: (assets: Array<C['assetAmounts']['read']['asset']> | undefined) => Promise<Array<C['assetAmounts']['read']>>;
};

export type PluginInstance<
    TAccountId extends string = string,
    C extends Partial<PICapabilities> = object,
> = {
    instanceId: () => Promise<TAccountId>;
} & Transact<TAccountId, PICapCfg<C> extends PICapabilities ? PICapCfg<C> : never> & C['extras'];

export type PICapabilitiesExtract<C extends PluginInstance<any, any>> = C extends PluginInstance<any, infer T extends Partial<PICapabilities>> ? T : never;

export type CreatePluginFn<TPI, TParams> = (host: Host, params: TParams) => Promise<TPI> | TPI;

import { Host } from "~/host";
import { AssetAmount, PrivateOperation, PublicOperation } from "~/shared";
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
    TAccountId extends string,
    TAssetAmounts extends AssetAmounts,
    TPrivateOperation extends PrivateOperation,
> = {
    prepareShield(asset: TAssetAmounts['input'], to?: TAccountId): Promise<PublicOperation>;
    prepareShieldMulti(assets: Array<AssetAmount>, to?: TAccountId): Promise<PublicOperation>;
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
> = Partial<Record<keyof TxFeatureMap<TAccountId, TAssetAmounts, TPrivateOperation>, boolean>>;

export type PICapabilities = {
    credential: unknown;
    features: TxFeatures;
    privateOp: PrivateOperation;
    assetAmounts: AssetAmounts;
};

export type PICapCfg<T extends Partial<PICapabilities> = object> = PICapabilities & T;

export type Transact<
    TAccountId extends string,
    C extends PICapabilities
> = Pick<TxFeatureMap<TAccountId, C['assetAmounts'], C['privateOp']>, EnabledKeys<TxFeatureMap<TAccountId, C['assetAmounts'], C['privateOp']>, C['features']>> & {
    balance: (assets: Array<C['assetAmounts']['internal']['asset']> | undefined) => Promise<Array<C['assetAmounts']['internal']>>;
};

export type PluginInstance<
    TAccountId extends string = string,
    C extends Partial<PICapabilities> = object,
> = {
    instanceId: () => Promise<TAccountId>;
} & Transact<TAccountId, PICapCfg<C>>;

export type PICapabilitiesExtract<C extends PluginInstance> = C extends PluginInstance<string, infer T extends Partial<PICapabilities>> ? PICapCfg<T> : never;

export type CreatePluginFn<TPI, TParams> = (host: Host, params: TParams) => Promise<TPI> | TPI;

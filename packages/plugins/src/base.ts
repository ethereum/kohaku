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
    TPublicOperation extends PublicOperation,
    TPrivateOperation extends PrivateOperation,
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
    TPublicOperation extends PublicOperation = PublicOperation,
    TPrivateOperation extends PrivateOperation = PrivateOperation,
> = Partial<Record<keyof TxFeatureMap<TAccountId, TAssetAmounts, TPublicOperation, TPrivateOperation>, boolean>>;

export type PICapabilities = {
    credential: unknown;
    features: TxFeatures;
    privateOp: PrivateOperation;
    publicOp: PublicOperation;
    assetAmounts: AssetAmounts;
    extraFeatures: Record<string, any>;
};

export type PICapCfg<T extends Partial<PICapabilities> = object> = {
    [key in keyof PICapabilities]: undefined extends T[key] ? PICapabilities[key] : T[key];
};

export type Transact<
    TAccountId extends string,
    C extends PICapabilities
> = Pick<TxFeatureMap<TAccountId, C['assetAmounts'], C['publicOp'], C['privateOp']>, EnabledKeys<TxFeatureMap<TAccountId, C['assetAmounts'], C['publicOp'], C['privateOp']>, C['features']>> & {
    balance: (assets?: Array<C['assetAmounts']['internal']['asset']>) => Promise<Array<C['assetAmounts']['internal']>>;
};

export type PluginInstance<
    TAccountId extends string = string,
    C extends Partial<PICapabilities> = object,
> = {
    instanceId: () => Promise<TAccountId>;
} & Transact<TAccountId, PICapCfg<C> extends PICapabilities ? PICapCfg<C> : never>
    & { [key in keyof C['extraFeatures']]: C['extraFeatures'][key] };

export type PICapabilitiesExtract<C extends PluginInstance<any, any>> = C extends PluginInstance<any, infer T extends Partial<PICapabilities>> ? T : never;

export type CreatePluginFn<TPI, TParams> = (host: Host, params: TParams) => Promise<TPI> | TPI;

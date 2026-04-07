import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { AssetAmount, ERC20AssetId, PluginInstance } from "@kohaku-eth/plugins";
import { IInstanceRegistry, TCPrivateOperation, TCPublicOperation, PrivacyPoolsV1ProtocolParams, ITornadoArtifacts } from '../plugin/interfaces/protocol-params.interface.js';
import { Address } from 'ox/Address';
import { ITornadoWithdrawResponse } from "../relayer/interfaces/relayer-client.interface.js";

export type TCBroadcasterParameters = {};
export type TCBroadcaster = Broadcaster<TCPrivateOperation, ITornadoWithdrawResponse[]>;
interface TCBaseCredential {
    accountIndex: number;
}
export interface TCPluginParameters extends TCBroadcasterParameters, TCBaseCredential {
    instanceRegistry: IInstanceRegistry;
    initialState?: PrivacyPoolsV1ProtocolParams['initialState'];
    artifacts?: ITornadoArtifacts;
};

export type TCAddress = Address;

export type TCAssetAmount<Tag extends string | undefined = undefined> = AssetAmount<ERC20AssetId, bigint, Tag>;
export type TCAssetBalance = TCAssetAmount;

export type TCInstance = PluginInstance<
    TCAddress,
    {
        features: {
            prepareShield: true,
            prepareUnshield: true,
        },
        assetAmounts: {
            input: TCAssetAmount,
            internal: TCAssetAmount,
            output: TCAssetAmount,
            read: TCAssetBalance,
        },
        extras: {
            sync(): Promise<void>,
        },
        publicOp: TCPublicOperation,
        privateOp: TCPrivateOperation,
    }
>;


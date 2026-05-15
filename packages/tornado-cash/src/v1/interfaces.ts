import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { AssetAmount, ERC20AssetId, PluginInstance } from "@kohaku-eth/plugins";
import { TCPrivateOperation, TCPublicOperation, PrivacyPoolsV1ProtocolParams, ITornadoArtifacts, TCProtocolConfig } from '../plugin/interfaces/protocol-params.interface.js';
import { Address } from 'ox/Address';
import { IRelayerClient, ITornadoWithdrawResponse } from "../relayer/interfaces/relayer-client.interface.js";
import { DepositStrategy } from '../state/thunks/getDepositPayloadThunk.js';
import { IRelayerFeeConfig } from "../state/slices/relayersSlice.js";
export { DepositStrategy };

export type TCBroadcasterParameters = {
    relayerClientFactory?: () => IRelayerClient;
};
export type TCBroadcaster = Broadcaster<TCPrivateOperation, ITornadoWithdrawResponse[]>;
interface TCBaseCredential {
    accountIndex: number;
}
export interface TCPluginParameters extends TCBroadcasterParameters, TCBaseCredential {
    protocolConfig: TCProtocolConfig;
    relayerConfig?: IRelayerFeeConfig;
    initialState?: PrivacyPoolsV1ProtocolParams['initialState'];
    artifacts: ITornadoArtifacts;
    stateManagerWorkerUrl?: string;
};

export type TCAddress = Address;

export type TCAssetAmount<Tag extends string | undefined = undefined> = AssetAmount<ERC20AssetId, bigint, Tag>;
export type TCAssetBalance = TCAssetAmount;

export interface TCPrepareUnshieldOptions {
    preferredRelayersEns?: string[];
}

export interface TCPrepareShieldOptions {
    strategy: DepositStrategy;
}

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
            prepareShield(asset: TCAssetAmount, options: TCPrepareShieldOptions): Promise<TCPublicOperation>;
            prepareUnshield(asset: TCAssetAmount, to: Address, options: TCPrepareUnshieldOptions): Promise<TCPrivateOperation>,
        },
        publicOp: TCPublicOperation,
        privateOp: TCPrivateOperation,
    }
>;

import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { AssetAmount, ERC20AssetId, PluginInstance, UnshieldOptions } from "@kohaku-eth/plugins";
import { TCPrivateOperation, TCPublicOperation, TCProtocolParams, ITornadoArtifacts, TCProtocolConfig, DelegationConfig, IChainsPaymastersConfig, TCNote } from '../plugin/interfaces/protocol-params.interface.js';
import { TxData } from '@kohaku-eth/provider';
import { Address } from 'ox/Address';
import { IRelayerClient, ITornadoWithdrawResponse } from "../relayer/interfaces/relayer-client.interface.js";
import { DepositStrategy } from '../state/thunks/getDepositPayloadThunk.js';
import { IRelayerFeeConfig } from "../state/slices/relayersSlice.js";
import { IPaymasterBroadcasterClient } from "../relayer/interfaces/paymaster-client.interface.js";
export { DepositStrategy };
export type { TCNote };

export type TCBroadcasterParameters = {
    relayerClientFactory?: () => IRelayerClient;
    paymasterConfig?: IChainsPaymastersConfig;
    paymasterClientFactory?: () => IPaymasterBroadcasterClient
};
export type TCBroadcaster = Broadcaster<TCPrivateOperation, ITornadoWithdrawResponse[]>;
interface TCBaseCredential {
    accountIndex: number;
}
export interface TCPluginParameters extends TCBroadcasterParameters, TCBaseCredential, Pick<TCProtocolParams, 'initialState'> {
    protocolConfig: TCProtocolConfig;
    relayerConfig?: IRelayerFeeConfig;
    stateManagerWorkerUrl?: string;
    artifactsLoader?: () => Promise<ITornadoArtifacts>;
};

export type TCAddress = Address;

export type TCAssetAmount<Tag extends string | undefined = undefined> = AssetAmount<ERC20AssetId, bigint, Tag>;
export type TCAssetBalance = TCAssetAmount;

export interface TCRelayerUnshieldOptions extends UnshieldOptions {
    mode: 'relayer';
    preferredRelayersEns?: string[];
}

export interface TCPaymasterUnshieldOptions extends UnshieldOptions {
    mode: 'paymaster';
    delegation?: DelegationConfig;
}

export type TCPrepareUnshieldOptions = TCRelayerUnshieldOptions | TCPaymasterUnshieldOptions;

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
        note: TCNote,
        extras: {
            sync(): Promise<void>,
            prepareShield(asset: TCAssetAmount, options: TCPrepareShieldOptions): Promise<TCPublicOperation>;
            prepareUnshield(asset: TCAssetAmount, to: Address, options: TCRelayerUnshieldOptions): Promise<TCPrivateOperation<'relayer'>>,
            prepareUnshield(asset: TCAssetAmount, to: Address, options: TCPaymasterUnshieldOptions): Promise<TCPrivateOperation<'paymaster'>>,

        },
        publicOp: TCPublicOperation,
        privateOp: TCPrivateOperation,
    }
>;

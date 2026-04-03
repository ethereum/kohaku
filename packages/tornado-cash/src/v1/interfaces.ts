import { Broadcaster } from "@kohaku-eth/plugins/broadcaster";
import { AssetAmount, ERC20AssetId, PluginInstance } from "@kohaku-eth/plugins";
import { IInstanceRegistry, INote, PPv1PrivateOperation, PPv1PublicOperation, PrivacyPoolsV1ProtocolParams } from '../plugin/interfaces/protocol-params.interface.js';
import { Address } from 'ox/Address';
import { ISuccessfullRelayResponse } from "../relayer/interfaces/relayer-client.interface.js";

export type PPv1BroadcasterParameters = {
    broadcasterUrl: string | Record<string, string>;
};
export type PPv1Broadcaster = Broadcaster<PPv1PrivateOperation, ISuccessfullRelayResponse>;
interface PPv1BaseCredential {
    accountIndex: number;
}
export interface PPv1PluginParameters extends PPv1BroadcasterParameters, PPv1BaseCredential {
    instanceRegistry: IInstanceRegistry;
    ipfsUrl?: string;
    initialState?: PrivacyPoolsV1ProtocolParams['initialState']
};
export interface PPv1PluginWithMnemonicParameters extends PPv1PluginParameters {
    mnemonic: string;
}

export type PPv1Address = Address;

export type PPv1AssetAmount<Tag extends string | undefined = undefined> = AssetAmount<ERC20AssetId, bigint, Tag>;
export type PPv1AssetBalance = PPv1AssetAmount<'pending'>;

export interface PPv1NativeCredential extends PPv1BaseCredential {
    type: 'native';
}

export interface PPv1MnemonicCretendial extends PPv1BaseCredential {
    type: 'mnemonic';
    mnemonic: string;
}

export type PPv1Credentials = PPv1NativeCredential | PPv1MnemonicCretendial;

type PPv1InstanceFactory<Credential extends PPv1Credentials> = PluginInstance<
    PPv1Address,
    {
        credential: Credential,
        features: {
            prepareShield: true,
            prepareUnshield: true,
        },
        assetAmounts: {
            input: PPv1AssetAmount,
            internal: PPv1AssetAmount,
            output: PPv1AssetAmount,
            read: PPv1AssetBalance,
        },
        extras: {
            notes(assets: ERC20AssetId[], includeSpent?: boolean): Promise<INote[]>,
            sync(): Promise<void>,
        },
        publicOp: PPv1PublicOperation,
        privateOp: PPv1PrivateOperation,
    }
>;

export type PPv1Instance = PPv1InstanceFactory<PPv1NativeCredential>;
export type PPv1LegacyInstance = PPv1InstanceFactory<PPv1MnemonicCretendial>;

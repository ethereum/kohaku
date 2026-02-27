import { TxData } from "@kohaku-eth/provider";
import { Hash } from "viem";
import { RailgunNetworkConfig } from "~/config";

export type CreateBroadcastFn = (txData: TxData) => Promise<Hash>;
export type CreateBroadcast = { broadcast: CreateBroadcastFn };

export type CreateBroadcastContext = {
    network: RailgunNetworkConfig;
};

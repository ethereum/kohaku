import { RailgunNetworkConfig } from "~/config";

export type AccountConfig = {
    network: RailgunNetworkConfig;
    startBlock?: number;
};

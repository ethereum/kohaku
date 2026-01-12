import { EthereumProvider } from '@kohaku-eth/provider';

export type Config = {
    provider: EthereumProvider;
    // Network configuration (think deployment address etc)
    // network: NetworkConfig;
};

export type Account = {};

export const createAccount = (config: Config): Account => {

    return {};
};

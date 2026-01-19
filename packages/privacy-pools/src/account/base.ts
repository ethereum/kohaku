import { EthereumProvider } from '@kohaku-eth/provider';

export type Config = {
    provider: EthereumProvider;
    // Network configuration (think deployment address etc)
    // network: NetworkConfig;
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Account = {};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const createAccount = (config: Config): Account => {

    return {};
};

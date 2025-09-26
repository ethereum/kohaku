import { AbstractProvider, FallbackProvider, JsonRpcProvider } from 'ethers';
import { PollingJsonRpcProvider } from './polling-json-rpc-provider';

export const assertIsPollingProvider = (provider: AbstractProvider) => {
  if (!isPollingProvider(provider)) {
    throw new Error(
      'The JsonRpcProvider must have polling enabled. Use PollingJsonRpcProvider to instantiate.',
    );
  }
};

const isPollingProvider = (provider: AbstractProvider): provider is PollingJsonRpcProvider => {
  return (provider as PollingJsonRpcProvider).isPollingProvider !== undefined;
};

/**
 * Fallback Providers don't poll correctly for events.
 * This function creates a PollingJsonRpcProvider from the first provider in the FallbackProvider.
 */
export const createPollingJsonRpcProviderForListeners = async (
  provider: JsonRpcProvider | FallbackProvider,
  chainId: number,
  pollingInterval?: number,
): Promise<PollingJsonRpcProvider> => {
  if (isPollingProvider(provider)) {
    return provider;
  }

  if (provider instanceof JsonRpcProvider) {
     
    const { url } = provider._getConnection();

    return new PollingJsonRpcProvider(url, chainId, pollingInterval);
  }

  const { providerConfigs } = provider;

  if (!providerConfigs.length) {
    throw new Error("Need to supply at least one fallback provider");
  }

  const [ { provider: firstProviderConfig } ] = providerConfigs;

  const firstProvider = firstProviderConfig as JsonRpcProvider;

   
  const { url } = firstProvider._getConnection();

   
  const maxLogsPerBatch = firstProvider._getOption('batchMaxCount');

  return new PollingJsonRpcProvider(url, chainId, pollingInterval, maxLogsPerBatch);
};

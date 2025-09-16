import { JsonRpcProvider, JsonRpcApiProviderOptions, Network } from 'ethers';

/**
 * Uses a setting in JsonRpcProvider to poll for events,
 * rather than using sparsely-implemented eth_filter events.
 */
export class PollingJsonRpcProvider extends JsonRpcProvider {
  constructor(url: string, chainId: number, pollingInterval = 10000, maxLogsPerBatch = 100) {
    const network = Network.from(chainId);
    const options: JsonRpcApiProviderOptions = {
      polling: true,
      staticNetwork: network,
      batchMaxCount: maxLogsPerBatch,
    };
    super(url, network, options);
    this.pollingInterval = pollingInterval;
  }

  readonly isPollingProvider: boolean = true;
}

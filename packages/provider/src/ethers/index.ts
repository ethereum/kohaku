import type { JsonRpcProvider, Log } from 'ethers';
import type { TxLog, TransactionReceipt } from '../tx';
import type { EthereumProvider } from '../provider';
export * from './signer';

/**
 * Ethers v6 provider adapter
 */
export const ethers = (provider: JsonRpcProvider): EthereumProvider<JsonRpcProvider> => {
  return {
    _internal: provider,
    async getLogs(params: {
      address: string;
      fromBlock: number;
      toBlock: number;
    }): Promise<TxLog[]> {
      const logs = await provider.getLogs(params);

      return logs.map(convertLog);
    },
    async getBlockNumber(): Promise<number> {
      return await provider.getBlockNumber();
    },
    async waitForTransaction(txHash: string): Promise<void> {
      await provider.waitForTransaction(txHash);
    },
    async getBalance(address: string): Promise<bigint> {
      return await provider.getBalance(address);
    },
    async getCode(address: string): Promise<string> {
      return await provider.getCode(address);
    },
    async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
      const receipt = await provider.getTransactionReceipt(txHash);

      if (!receipt) return null;

      return {
        blockNumber: receipt.blockNumber,
        status: receipt.status ?? 0,
        logs: receipt.logs.map(convertLog),
        gasUsed: receipt.gasUsed,
      };
    }
  };
};

const convertLog = (log: Log): TxLog => {
  return {
    blockNumber: log.blockNumber,
    topics: [...log.topics],
    data: log.data,
    address: log.address,
  };
};

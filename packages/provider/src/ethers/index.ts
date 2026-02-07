import type { JsonRpcProvider, Log } from 'ethers';
import { Filter } from 'ox';
import type { TxLog, TransactionReceipt } from '../tx';
import type { EthereumProvider } from '../provider';
import { AddressLike } from 'ethers';
import { HexString } from '~/raw/hex';
export * from './signer';

/**
 * Ethers v6 provider adapter
 */
export const ethers = (provider: JsonRpcProvider): EthereumProvider<JsonRpcProvider> => {
  return {
    _internal: provider,
    async getLogs({ address, fromBlock, toBlock, topics }: Filter.Filter): Promise<TxLog[]> {
      const logs = await provider.getLogs({
        address: address as AddressLike,
        // blockHash,
        fromBlock,
        toBlock,
        topics: topics as HexString[],
      });

      return logs.map(convertLog);
    },
    async getBlockNumber(): Promise<bigint> {
      return BigInt(await provider.getBlockNumber());
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
        blockNumber: BigInt(receipt.blockNumber),
        status: BigInt(receipt.status ?? 0),
        logs: receipt.logs.map(convertLog),
        gasUsed: receipt.gasUsed,
      };
    }
  };
};

const convertLog = (log: Log): TxLog => {
  return {
    blockNumber: BigInt(log.blockNumber),
    topics: [...log.topics],
    data: log.data,
    address: log.address,
  };
};

import type { TxLog, TransactionReceipt } from '../tx';
import type { EthereumProvider } from '../provider';
import { convertLog, formatReceipt, type ViemPublicClient } from './types';

export const viem = (client: ViemPublicClient): EthereumProvider<ViemPublicClient> => {
  return {
    _internal: client,
    async getLogs(params: { address: string; fromBlock: number; toBlock: number }): Promise<TxLog[]> {
      const logs = await client.getLogs({
        address: params.address as `0x${string}`,
        fromBlock: BigInt(params.fromBlock),
        toBlock: BigInt(params.toBlock),
      });

      return logs.map(convertLog);
    },
    async getBlockNumber(): Promise<number> {
      return Number(await client.getBlockNumber());
    },
    async waitForTransaction(txHash: string): Promise<void> {
      await client.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
    },
    async getBalance(address: string): Promise<bigint> {
      return client.getBalance({ address: address as `0x${string}` });
    },
    async getCode(address: string): Promise<string> {
      const code = await client.getCode({ address: address as `0x${string}` });

      return code ?? '0x';
    },
    async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
      const receipt = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });

      if (!receipt) return null;

      return formatReceipt(receipt);
    }
  }
};

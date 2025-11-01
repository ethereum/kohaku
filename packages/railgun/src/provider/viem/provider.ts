import type { RailgunLog, RailgunProvider, TransactionReceipt } from '../provider';
import { convertLog, formatReceipt, type ViemPublicClient } from './types';

export class ViemProviderAdapter implements RailgunProvider {
  constructor(private readonly client: ViemPublicClient) {}

  async getLogs(params: { address: string; fromBlock: number; toBlock: number }): Promise<RailgunLog[]> {
    const logs = await this.client.getLogs({
      address: params.address as `0x${string}`,
      fromBlock: BigInt(params.fromBlock),
      toBlock: BigInt(params.toBlock),
    });

    return logs.map(convertLog);
  }

  async getBlockNumber(): Promise<number> {
    return Number(await this.client.getBlockNumber());
  }

  async waitForTransaction(txHash: string): Promise<void> {
    await this.client.waitForTransactionReceipt({ hash: txHash as `0x${string}` });
  }

  async getBalance(address: string): Promise<bigint> {
    return this.client.getBalance({ address: address as `0x${string}` });
  }

  async getCode(address: string): Promise<string> {
    const code = await this.client.getCode({ address: address as `0x${string}` });

    return code ?? '0x';
  }

  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    const receipt = await this.client.getTransactionReceipt({ hash: txHash as `0x${string}` });

    if (!receipt) return null;

    return formatReceipt(receipt);
  }
}

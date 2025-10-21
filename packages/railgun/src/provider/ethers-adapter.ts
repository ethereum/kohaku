import type { JsonRpcProvider, Log, Wallet } from 'ethers';
import type { RailgunProvider, RailgunSigner, TransactionReceipt } from './provider';
import type { RailgunLog } from '../indexer';
import type { TxData } from '../account';

/**
 * Ethers v6 provider adapter
 */
export class EthersProviderAdapter implements RailgunProvider {
  constructor(private provider: JsonRpcProvider) {}

  async getLogs(params: {
    address: string;
    fromBlock: number;
    toBlock: number;
  }): Promise<RailgunLog[]> {
    const logs = await this.provider.getLogs(params);

    return logs.map(log => this.convertLog(log));
  }

  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async waitForTransaction(txHash: string): Promise<void> {
    await this.provider.waitForTransaction(txHash);
  }

  async getBalance(address: string): Promise<bigint> {
    return await this.provider.getBalance(address);
  }

  async getCode(address: string): Promise<string> {
    return await this.provider.getCode(address);
  }

  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    const receipt = await this.provider.getTransactionReceipt(txHash);

    if (!receipt) return null;

    return {
      blockNumber: receipt.blockNumber,
      status: receipt.status ?? 0,
      logs: receipt.logs.map(log => this.convertLog(log)),
      gasUsed: receipt.gasUsed,
    };
  }

  private convertLog(log: Log): RailgunLog {
    return {
      blockNumber: log.blockNumber,
      topics: [...log.topics],
      data: log.data,
      address: log.address,
    };
  }

  /**
   * Get the underlying Ethers provider
   * @deprecated Use the RailgunProvider interface methods instead
   */
  getProvider(): JsonRpcProvider {
    return this.provider;
  }
}

/**
 * Ethers v6 signer adapter
 */
export class EthersSignerAdapter implements RailgunSigner {
  constructor(private signer: Wallet) {}

  async signMessage(message: string | Uint8Array): Promise<string> {
    return await this.signer.signMessage(message);
  }

  async sendTransaction(tx: TxData): Promise<string> {
    const txResponse = await this.signer.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ?? 0n,
      gasLimit: tx.gasLimit ?? tx.gas ?? 6000000, // Ethers uses 'gasLimit', fallback to gas then default
    });

    return txResponse.hash;
  }

  async getAddress(): Promise<string> {
    return await this.signer.getAddress();
  }
}

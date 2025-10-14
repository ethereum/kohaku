import type { JsonRpcProvider, Log, Wallet } from 'ethers';
import type { RailgunProvider, RailgunSigner } from './provider';
import type { RailgunLog, TxData } from '../account-utils/types';

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
    const logs = await this.provider.getLogs({
      address: params.address,
      fromBlock: params.fromBlock,
      toBlock: params.toBlock,
    });

    return logs.map(log => this.convertLog(log));
  }

  async getBlockNumber(): Promise<number> {
    return await this.provider.getBlockNumber();
  }

  async waitForTransaction(txHash: string): Promise<void> {
    await this.provider.waitForTransaction(txHash);
  }

  private convertLog(log: Log): RailgunLog {
    return {
      blockNumber: log.blockNumber,
      topics: [...log.topics],
      data: log.data,
      address: log.address,
    };
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

  async sendTransaction(tx: TxData & { gasLimit?: number | bigint }): Promise<string> {
    const txResponse = await this.signer.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value,
      gasLimit: tx.gasLimit ?? 6000000,
    });
    return txResponse.hash;
  }

  async getAddress(): Promise<string> {
    return await this.signer.getAddress();
  }
}

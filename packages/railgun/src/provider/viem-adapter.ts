import type { RailgunProvider, RailgunSigner, TransactionReceipt } from './provider';
import type { RailgunLog, TxData } from '../account-utils/types';

// Viem types (will work when viem is installed)
type ViemPublicClient = {
  getLogs: (params: {
    address: `0x${string}`;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<ViemLog[]>;
  getBlockNumber: () => Promise<bigint>;
  waitForTransactionReceipt: (params: { hash: `0x${string}` }) => Promise<ViemTransactionReceipt>;
  getBalance: (params: { address: `0x${string}` }) => Promise<bigint>;
  getCode: (params: { address: `0x${string}` }) => Promise<`0x${string}`>;
  getTransactionReceipt: (params: { hash: `0x${string}` }) => Promise<ViemTransactionReceipt | null>;
};

type ViemWalletClient = {
  account: { address: `0x${string}` };
  signMessage: (params: { message: string | { raw: Uint8Array } }) => Promise<`0x${string}`>;
  sendTransaction: (params: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
    gas?: bigint;
  }) => Promise<`0x${string}`>;
};

type ViemLog = {
  blockNumber: bigint;
  topics: `0x${string}`[];
  data: `0x${string}`;
  address: `0x${string}`;
};

type ViemTransactionReceipt = {
  blockNumber: bigint;
  status: 'success' | 'reverted';
  logs: ViemLog[];
  gasUsed: bigint;
};

/**
 * Viem provider adapter
 */
export class ViemProviderAdapter implements RailgunProvider {
  constructor(private client: ViemPublicClient) {}

  async getLogs(params: {
    address: string;
    fromBlock: number;
    toBlock: number;
  }): Promise<RailgunLog[]> {
    const logs = await this.client.getLogs({
      address: params.address as `0x${string}`,
      fromBlock: BigInt(params.fromBlock),
      toBlock: BigInt(params.toBlock),
    });

    return logs.map(log => this.convertLog(log));
  }

  async getBlockNumber(): Promise<number> {
    const blockNumber = await this.client.getBlockNumber();
    return Number(blockNumber);
  }

  async waitForTransaction(txHash: string): Promise<void> {
    await this.client.waitForTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
  }

  async getBalance(address: string): Promise<bigint> {
    return await this.client.getBalance({
      address: address as `0x${string}`,
    });
  }

  async getCode(address: string): Promise<string> {
    return await this.client.getCode({
      address: address as `0x${string}`,
    });
  }

  async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
    const receipt = await this.client.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });

    if (!receipt) return null;

    return {
      blockNumber: Number(receipt.blockNumber),
      status: receipt.status === 'success' ? 1 : 0,
      logs: receipt.logs.map(log => this.convertLog(log)),
      gasUsed: receipt.gasUsed,
    };
  }

  private convertLog(log: ViemLog): RailgunLog {
    return {
      blockNumber: Number(log.blockNumber),
      topics: log.topics,
      data: log.data,
      address: log.address,
    };
  }
}

/**
 * Viem signer adapter
 */
export class ViemSignerAdapter implements RailgunSigner {
  constructor(private wallet: ViemWalletClient) {}

  async signMessage(message: string | Uint8Array): Promise<string> {
    const signature = await this.wallet.signMessage({
      message: typeof message === 'string' ? message : { raw: message },
    });
    return signature;
  }

  async sendTransaction(tx: TxData & { gasLimit?: number | bigint }): Promise<string> {
    const hash = await this.wallet.sendTransaction({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: tx.value,
      gas: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
    });
    return hash;
  }

  async getAddress(): Promise<string> {
    return this.wallet.account.address;
  }
}

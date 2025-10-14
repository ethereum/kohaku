import { JsonRpcProvider } from 'ethers';
import type { RailgunLog, TxData } from '../account-utils/types';

/**
 * Abstract provider interface for blockchain interactions
 * Supports both Ethers v6 and Viem implementations
 */
export interface RailgunProvider {
  /**
   * Fetch logs from the blockchain
   */
  getLogs(params: {
    address: string;
    fromBlock: number;
    toBlock: number;
  }): Promise<RailgunLog[]>;

  /**
   * Get the current block number
   */
  getBlockNumber(): Promise<number>;

  /**
   * Wait for a transaction to be mined
   */
  waitForTransaction(txHash: string): Promise<void>;

  /**
   * Get the provider
   */
  getProvider(): JsonRpcProvider;
}

/**
 * Abstract signer interface for transaction signing and submission
 * Supports both Ethers v6 and Viem implementations
 */
export interface RailgunSigner {
  /**
   * Sign a message
   */
  signMessage(message: string | Uint8Array): Promise<string>;

  /**
   * Send a transaction
   */
  sendTransaction(tx: TxData & { gasLimit?: number | bigint }): Promise<string>;

  /**
   * Get the signer's address
   */
  getAddress(): Promise<string>;
}

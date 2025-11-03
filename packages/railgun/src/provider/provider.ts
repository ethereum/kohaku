import { TxData } from "~/account/tx/base";

export interface RailgunLog {
  blockNumber: number;
  topics: string[];
  data: string;
  address: string;
}

export interface TransactionReceipt {
  blockNumber: number;
  status: number;
  logs: RailgunLog[];
  gasUsed: bigint;
}

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
   * Get the balance of an address
   */
  getBalance(address: string): Promise<bigint>;

  /**
   * Get the code at an address
   */
  getCode(address: string): Promise<string>;

  /**
   * Get transaction receipt
   */
  getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null>;
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
  sendTransaction(tx: TxData): Promise<string>;

  /**
   * Get the signer's address
   */
  getAddress(): Promise<string>;
}

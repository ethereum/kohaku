import { Filter } from "ox/Filter";
import { TxLog, TransactionReceipt, CallData, TxData } from "./tx";
import { RpcRequest } from "ox/RpcRequest";

/**
 * Abstract provider interface for blockchain interactions
 * Supports both Ethers v6 and Viem implementations
 */
export type EthereumProvider<T = unknown> = {
  _internal: T;

  /**
   * Get the chain ID
   */
  getChainId(): Promise<bigint>;

  /**
   * Fetch logs from the blockchain
   */
  getLogs(params: Filter): Promise<TxLog[]>;

  /**
   * Get the current block number
   */
  getBlockNumber(): Promise<bigint>;

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

  /**
   * Generic make request method to be able to use ABIs
   */
  request(request: Pick<RpcRequest, 'method' | 'params'>): Promise<unknown>;

  /**
   * Make a call to the blockchain without sending a transaction
   */
  call(call: CallData): Promise<`0x${string}` | undefined>;

  /**
   * Estimate gas for a transaction
   */
  estimateGas(call: CallData): Promise<bigint>;

  /**
   * Get the current gas price
   */
  getGasPrice(): Promise<bigint>;
}

/**
 * Abstract signer interface for transaction signing and submission
 * Supports both Ethers v6 and Viem implementations
 */
export interface TxSigner {
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
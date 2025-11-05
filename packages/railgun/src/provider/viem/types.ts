import type { RailgunLog, TransactionReceipt } from "../provider";

export type ViemPublicClient = {
  getLogs: (params: {
    address: `0x${string}`;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<ViemLog[]>;
  getBlockNumber: () => Promise<bigint>;
  waitForTransactionReceipt: (params: {
    hash: `0x${string}`;
  }) => Promise<ViemTransactionReceipt>;
  getBalance: (params: { address: `0x${string}` }) => Promise<bigint>;
  getCode: (params: {
    address: `0x${string}`;
  }) => Promise<`0x${string}` | undefined>;
  getTransactionReceipt: (params: {
    hash: `0x${string}`;
  }) => Promise<ViemTransactionReceipt | null>;
};

export type ViemWalletClient = {
  account: { address: `0x${string}` } | undefined;
  signMessage: (params: {
    message: string | { raw: Uint8Array };
  }) => Promise<`0x${string}`>;
  sendTransaction: (params: {
    to: `0x${string}`;
    data: `0x${string}`;
    value: bigint;
    gas?: bigint;
  }) => Promise<`0x${string}`>;
};

export type ViemLog = {
  blockNumber: bigint;
  topics: `0x${string}`[];
  data: `0x${string}`;
  address: `0x${string}`;
};

export type ViemTransactionReceipt = {
  blockNumber: bigint;
  status: "success" | "reverted";
  logs: ViemLog[];
  gasUsed: bigint;
};

export const formatReceipt = (
  receipt: ViemTransactionReceipt
): TransactionReceipt => ({
  blockNumber: Number(receipt.blockNumber),
  status: receipt.status === "success" ? 1 : 0,
  logs: receipt.logs.map(convertLog),
  gasUsed: receipt.gasUsed,
});

export const convertLog = (log: ViemLog): RailgunLog => ({
  blockNumber: Number(log.blockNumber),
  topics: log.topics,
  data: log.data,
  address: log.address,
});

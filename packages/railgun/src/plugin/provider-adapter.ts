import { EthereumProvider, TransactionReceipt, TxLog } from "@kohaku-eth/provider";
import { Address, Hash, Log, PublicClient } from "viem";

export class EIP1193ProviderAdapter implements EthereumProvider {
    _internal: PublicClient;

    constructor(provider: PublicClient) {
        this._internal = provider;
    }

    async getLogs(params: {
        address: string;
        fromBlock: number;
        toBlock: number;
    }): Promise<TxLog[]> {
        const logs = await this._internal.getLogs({
            address: params.address as Address,
            fromBlock: BigInt(params.fromBlock),
            toBlock: BigInt(params.toBlock),
        });

        return logs.map((log) => createTxLog(log));
    }

    async getBlockNumber(): Promise<number> {
        const blockNumber = await this._internal.getBlockNumber();
        return Number(blockNumber);
    }

    async waitForTransaction(txHash: string): Promise<void> {
        await this._internal.waitForTransactionReceipt({ hash: txHash as Hash });
    }

    async getBalance(address: string): Promise<bigint> {
        const balance = await this._internal.getBalance({ address: address as Address });
        return balance;
    }

    async getCode(address: string): Promise<string> {
        const code = await this._internal.getCode({ address: address as Address });
        if (code === undefined) {
            return "0x";
        }

        return code;
    }

    async getTransactionReceipt(txHash: string): Promise<TransactionReceipt | null> {
        const receipt = await this._internal.getTransactionReceipt({ hash: txHash as Hash });
        if (!receipt) {
            return null;
        }

        return {
            blockNumber: Number(receipt.blockNumber),
            status: receipt.status === "success" ? 1 : 0,
            gasUsed: receipt.gasUsed,
            logs: receipt.logs.map((log) => createTxLog(log)),
        }
    }
}

function createTxLog(log: Log): TxLog {
    return {
        blockNumber: Number(log.blockNumber),
        topics: log.topics,
        data: log.data,
        address: log.address
    };
}

export interface TxLog {
    blockNumber: bigint;
    topics: string[];
    data: string;
    address: string;
}

export interface TransactionReceipt {
    blockNumber: bigint;
    status: bigint;
    logs: TxLog[];
    gasUsed: bigint;
}

export type TxData = {
    to: string;
    data: string;
    value: bigint;
};

export type CallData = {
    to: `0x${string}`;
    from: `0x${string}` | undefined;
    gas: `0x${string}` | undefined;
    gasPrice: `0x${string}` | undefined;
    value: `0x${string}` | undefined;
    input: `0x${string}` | undefined;
    block: `0x${string}` | 'latest' | 'pending' | 'earliest' | undefined;
}

export const createTx = (address: string, payload: string, value: bigint = BigInt(0)): TxData => {
    return {
        to: address,
        data: payload,
        value: value,
    };
};

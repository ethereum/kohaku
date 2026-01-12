export interface TxLog {
    blockNumber: number;
    topics: string[];
    data: string;
    address: string;
}

export interface TransactionReceipt {
    blockNumber: number;
    status: number;
    logs: TxLog[];
    gasUsed: bigint;
}

export type TxData = {
    to: string;
    data: string;
    value: bigint;
};

export const createTx = (address: string, payload: string, value: bigint = BigInt(0)): TxData => {
    return {
        to: address,
        data: payload,
        value: value,
    };
};

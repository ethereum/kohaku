import { ByteUtils } from "./bytes";

export const minBigInt = (a: bigint, b: bigint): bigint => (a < b ? a : b);

export const stringToBigInt = (str: string): bigint => {
    const decimalPattern = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;
    const isDecimalStr = decimalPattern.test(str);
    if (isDecimalStr) {
        return BigInt(str);
    }

    return ByteUtils.hexToBigInt(str);
};

export type HexString = `0x${string}`;

export const assertHexQuantity = (value: string): void => {
    if (!/^0x[0-9a-fA-F]+$/.test(value)) {
        throw new Error(`Expected hex quantity, got: ${String(value)}`);
    }
}

export const toQuantityHex = (value: number | bigint): string => {
    const v = typeof value === 'bigint' ? value : BigInt(value);

    if (v < 0n) {
        throw new Error(`Expected non-negative quantity, got: ${String(value)}`);
    }

    return `0x${v.toString(16)}`;
}

export const hexToBigInt = (value: string): bigint => {
    assertHexQuantity(value);

    return BigInt(value);
}

export const hexToNumber = (value: string): number => {
    const n = hexToBigInt(value);

    return Number(n);
}

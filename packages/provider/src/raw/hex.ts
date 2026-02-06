export type HexString = `0x${string}`;

export const assertHexQuantity = (value: string): void => {
    if (!/^0x[0-9a-fA-F]+$/.test(value)) {
        throw new Error(`Expected hex quantity, got: ${String(value)}`);
    }
}

export const toQuantityHex = (value: number | bigint): string => {
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(`Expected non-negative safe integer, got: ${String(value)}`);
        }
    }

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

    if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`Quantity exceeds MAX_SAFE_INTEGER: ${value}`);
    }

    return Number(n);
}

/**
 * Parses an Ethereum JSON-RPC "quantity" into a JS number, tolerating a few
 * non-spec provider implementations that return numbers/bigints directly.
 *
 * Accepts:
 * - hex quantity string: "0x..."
 * - safe integer number: 123
 * - bigint within safe range: 123n
 * - (optionally) decimal string: "123"
 */
export const maybeQuantityToNumber = (value: unknown): number => {
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(`Expected non-negative safe integer, got: ${String(value)}`);
        }

        return value;
    }

    if (typeof value === 'bigint') {
        if (value < 0n) {
            throw new Error(`Expected non-negative quantity, got: ${String(value)}`);
        }

        if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new Error(`Quantity exceeds MAX_SAFE_INTEGER: ${String(value)}`);
        }

        return Number(value);
    }

    if (typeof value === 'string') {
        // Spec-compliant quantity.
        if (value.startsWith('0x') || value.startsWith('0X')) {
            return hexToNumber(value);
        }

        // Tolerate providers that return decimal strings.
        if (/^\d+$/.test(value)) {
            const n = BigInt(value);

            if (n > BigInt(Number.MAX_SAFE_INTEGER)) {
                throw new Error(`Quantity exceeds MAX_SAFE_INTEGER: ${value}`);
            }

            return Number(n);
        }

        throw new Error(`Expected quantity string, got: ${value}`);
    }

    throw new Error(`Expected quantity (hex string | number | bigint), got: ${typeof value}`);
}

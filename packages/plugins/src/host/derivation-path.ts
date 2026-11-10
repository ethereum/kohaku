export const HARDENED_OFFSET = 0x80000000;

// BIP-32 caps depth at 255. Each segment is a decimal index without leading
// zeros, optionally hardened with ' or h.
const MAX_DEPTH = 255;
const SEGMENT = /^(0|[1-9]\d*)(['h]?)$/;

/**
 * Parses a BIP-32 path ("m/44'/1984'/0'/0'/0'") into raw u32 indices (hardened
 * offset applied). Rejects anything else, including the master key "m" itself.
 */
export function parseDerivationPath(path: string): number[] {
    const segments = typeof path === "string" ? path.split("/") : [];

    if (segments[0] !== "m" || segments.length < 2 || segments.length > MAX_DEPTH + 1) {
        throw new Error(`Invalid derivation path: ${String(path)}`);
    }

    return segments.slice(1).map((segment) => {
        const match = SEGMENT.exec(segment);
        const index = match ? Number(match[1]) : NaN;

        if (!match || index >= HARDENED_OFFSET) {
            throw new Error(`Invalid path segment "${segment}" in ${path}`);
        }

        return match[2] ? index + HARDENED_OFFSET : index;
    });
}

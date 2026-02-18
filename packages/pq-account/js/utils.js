/**
 * Shared helpers used across signers and UI modules.
 */

/**
 * Convert a hex string (with or without 0x prefix) to a Uint8Array.
 */
export function hexToU8(hex) {
    if (hex.startsWith("0x")) hex = hex.slice(2);
    return Uint8Array.from(hex.match(/.{2}/g).map(b => parseInt(b, 16)));
}

/**
 * Pack 512 NTT coefficients (each ≤ 16 bits) into 32 uint256 words,
 * matching _ZKNOX_NTT_Compact in Solidity.
 *
 * @param {number[]|BigInt[]} coeffs - 512 coefficients
 * @returns {BigInt[]} 32 packed uint256 words
 */
export function nttCompact(coeffs) {
    if (coeffs.length !== 512)
        throw new Error("Expected 512 coefficients, got " + coeffs.length);

    const b = new Array(32).fill(0n);
    for (let i = 0; i < 512; i++) {
        const wordIndex = i >> 4;
        const bitShift = (i & 0xf) * 16;
        b[wordIndex] ^= BigInt(coeffs[i]) << BigInt(bitShift);
    }
    return b;
}

const EXPLORER_URLS = {
    1n:        'https://etherscan.io/tx/',
    11155111n: 'https://sepolia.etherscan.io/tx/',
    421614n:   'https://sepolia.arbiscan.io/tx/',
    84532n:    'https://sepolia.basescan.org/tx/',
};

/**
 * Return a block-explorer URL for the given chain + tx hash, or "".
 */
export function explorerTxUrl(chainId, txHash) {
    const base = EXPLORER_URLS[BigInt(chainId)];
    return base ? base + txHash : '';
}

/**
 * Redirect console.log / console.error into a DOM element so the
 * user sees output in the page.  Call once during setup().
 */
export function redirectConsole(outputEl) {
    const originalLog = console.log;
    const originalError = console.error;

    function format(args) {
        return args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ');
    }

    console.log = function (...args) {
        outputEl.textContent += format(args) + '\n';
        outputEl.scrollTop = outputEl.scrollHeight;
        originalLog.apply(console, args);
    };

    console.error = function (...args) {
        outputEl.textContent += '❌ ' + format(args) + '\n';
        outputEl.scrollTop = outputEl.scrollHeight;
        originalError.apply(console, args);
    };
}

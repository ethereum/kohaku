/** A 65-byte secp256k1 signature split into its parts. */
export type SignatureParts = { readonly r: bigint; readonly s: bigint; readonly v: number };

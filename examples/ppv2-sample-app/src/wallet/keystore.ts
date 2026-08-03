/**
 * WALLET SIDE — a `Keystore` for wallets that hold a raw private key instead
 * of a seed phrase.
 *
 * The Host `Keystore` contract only requires determinism: the same path must
 * always yield the same key. Without BIP-39 entropy, sub-keys are derived by
 * hashing the root key with the requested path (an HKDF-style expansion), so
 * the PPv2 signer key (`m/28784'/2'/0'`) is stable and recoverable from the
 * private key alone. NOTE: unlike real BIP-32, these sub-keys are NOT
 * hardened against root-key compromise — with a raw-key wallet there is only
 * one secret anyway.
 */
import type { Keystore } from "@kohaku-eth/plugins";
import type { Hex } from "viem";
import { concatHex, keccak256, toHex } from "viem";

/** secp256k1 group order; derived keys must land in [1, n-1]. */
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

export class PrivateKeyKeystore implements Keystore {
    constructor(private readonly rootPrivateKey: Hex) {}

    async deriveAt(path: string): Promise<Hex> {
        let candidate = keccak256(concatHex([this.rootPrivateKey, toHex(`ppv2-sample:${path}`)]));

        // Re-hash on the (astronomically unlikely) out-of-range candidate so the
        // result is always a valid secp256k1 private key.
        while (BigInt(candidate) === 0n || BigInt(candidate) >= SECP256K1_N) {
            candidate = keccak256(candidate);
        }

        return candidate;
    }
}

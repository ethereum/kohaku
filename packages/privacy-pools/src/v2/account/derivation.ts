import type { Keystore } from "@kohaku-eth/plugins";
import {
    APP_IDENTIFIER,
    CryptoService,
    type DeriveFromSignatureConfig,
    type Hex,
    KeystoreManager,
} from "@0xbow-io/privacy-pools-v2-sdk";
import { type Address, keccak256, toBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Dedicated Privacy Pools v2 BIP-32 path for the derivation signer key. Distinct
 * from the v1 family (`m/28784'/1'/...`) by version segment `2'`, so v1 and v2
 * accounts never collide (FR-010, INV-2). LOAD-BEARING: changing this path
 * invalidates every derived key — treat like a MAJOR crypto-constant change.
 */
export function ppv2SignerKeyPath(accountIndex = 0): string {
    return `m/28784'/2'/${accountIndex}'`;
}

/**
 * Human-readable EIP-712 purpose string. Byte-for-byte stable across releases —
 * it is part of the typed-data hash and therefore part of the derived key.
 * Mirrors the 0xbow reference payload (`apps/sample-web/secretDerivationPayload.ts`
 * in the 0xbow v2-monorepo — an upstream provenance pointer, not a path here).
 */
const SECRET_DERIVATION_PURPOSE =
    "This signature is used to deterministically derive application-specific secrets " +
    "from your master seed. It is not a transaction and will not cost any gas.";

/**
 * Build the canonical `SecretDerivation` EIP-712 typed data for a signer address.
 * Domain/types/message match the protocol reference so a signature over this
 * payload derives the intended keys. `salt = keccak256(utf8(APP_IDENTIFIER))`.
 */
function buildSecretDerivationTypedData(signerAddress: Address) {
    const addressHash = keccak256(toBytes(signerAddress));

    return {
        domain: {
            name: "Standardized Secret Derivation",
            version: "1",
            verifyingContract: "0x0000000000000000000000000000000000000000" as Address,
            salt: keccak256(toHex(APP_IDENTIFIER)),
        },
        types: {
            SecretDerivation: [
                { name: "purpose", type: "string" },
                { name: "addressHash", type: "bytes32" },
            ],
        },
        primaryType: "SecretDerivation" as const,
        message: { purpose: SECRET_DERIVATION_PURPOSE, addressHash },
        addressHash,
    };
}

/** A derived Privacy Pools v2 account: the SDK keystore manager plus the reusable config. */
export type DerivedAccount = {
    keystoreManager: KeystoreManager;
    /** Address of the in-memory signer key (used as HKDF salt + `instanceId` is separate). */
    signerAddress: Address;
    /**
     * The exact config used, so the plugin can re-derive on rotation and persist
     * `revocableKeyIndex` (the SDK does not persist it) — FR-013, R3.
     */
    deriveConfig: DeriveFromSignatureConfig;
};

/**
 * Deterministically derive the Privacy Pools v2 key material from the host
 * keystore alone (INV-2, FR-010/011/012). No external signer and no raw-key
 * injection: a key derived at {@link ppv2SignerKeyPath} signs the canonical
 * EIP-712 payload **in memory** (RFC-6979 deterministic), and the signature is
 * handed to `KeystoreManager.fromSignature` — preserving the SDK's
 * signature-based rotation / index recovery (FR-011).
 *
 * @param revocableKeyIndex `"0x0"` for a fresh account; the persisted value when
 *   re-hydrating a rotated account (required by the SDK config).
 */
export async function deriveKeystoreManager(params: {
    keystore: Keystore;
    accountIndex?: number;
    revocableKeyIndex?: Hex;
}): Promise<DerivedAccount> {
    const { keystore, accountIndex = 0, revocableKeyIndex = "0x0" } = params;

    const signerPrivateKey = await keystore.deriveAt(ppv2SignerKeyPath(accountIndex));
    const account = privateKeyToAccount(signerPrivateKey);
    const signerAddress = account.address;

    const typedData = buildSecretDerivationTypedData(signerAddress);
    const signature = await account.signTypedData({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
    });

    const deriveConfig: DeriveFromSignatureConfig = {
        signature,
        signerAddress,
        addressHash: typedData.addressHash,
        revocableKeyIndex,
    };

    const keystoreManager = KeystoreManager.fromSignature(deriveConfig, {
        cryptoService: new CryptoService(),
    });

    return { keystoreManager, signerAddress, deriveConfig };
}

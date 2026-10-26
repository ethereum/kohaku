import { Host } from '@kohaku-eth/plugins';
import { poseidon } from "maci-crypto/build/ts/hashing.js";

/** BIP32-BIP43 - Privacy Pools v1
 *   2**31
 *
 * m/purpose'/version'/account'/secretType'/deposit'/secretIndex'
 *   secretIndex: 0 = deposit secret, 1+ = withdrawal secrets
 *   PH[secret(N|C), entrypointAddress] -> circuit
 */

const PRIVACY_POOLS_PATH = "m/28784'/1'";

/** Every key Privacy Pools derives (legacy and signature secrets) sits below this path. */
export const PRIVACY_POOLS_KEYSTORE_PREFIX = PRIVACY_POOLS_PATH;

export interface Secret {
  nullifier: bigint;
  salt: bigint;
  precommitment: bigint;
  nullifierHash: bigint;
};

export type BaseDeriveSecretParams = {
  entrypointAddress: bigint;
  chainId: bigint;
};

export type DeriveDepositSecretParams = BaseDeriveSecretParams & {
  depositIndex: number;
};

export type DeriveWithdrawalSecretsParams = BaseDeriveSecretParams & {
  depositIndex: number;
  withdrawIndex: number;
};

export type DeriveSecretsParams = BaseDeriveSecretParams & {
  depositIndex: number;
  secretIndex: number;
};

export interface ISecretManager {
  getDepositSecrets: (params: DeriveDepositSecretParams) => Promise<Secret>;
  getSecrets: (params: DeriveWithdrawalSecretsParams) => Promise<Secret>;
  /**
   * Derives the private key of the ephemeral EOA that sends a paymaster-sponsored
   * withdrawal userOp. Deterministic per (accountIndex, chainId, entrypoint,
   * depositIndex, withdrawIndex), so a stuck sender is recoverable. The
   * withdrawIndex is required because privacy pools supports partial withdrawals:
   * the same deposit is spent across multiple userOps, each of which must use a
   * fresh single-use sender (nonce 0, one EIP-7702 authorization). The value is a
   * poseidon field element, which is always a valid secp256k1 scalar.
   */
  deriveEphemeralSigner: (params: DeriveWithdrawalSecretsParams) => Promise<`0x${string}`>;
  /**
   * Derives a delegator key from a classical wallet BIP-32 `path`, WITHOUT the
   * privacy transform the note/ephemeral derivations apply, so it resolves to a
   * recoverable, wallet-native Ethereum address. Used for the paymaster sender
   * when the integrator supplies a wallet path (see `paymasterWithdrawThunk`).
   */
  deriveDelegatorSigner: (params: { path: string }) => Promise<`0x${string}`>;
}

export interface SecretManagerParams {
  host: Host,
  accountIndex?: number;
}

/**
 * @deprecated Legacy BIP-32 HD secret derivation. Superseded by
 * {@link SignatureSecretManager} (signature-derived secrets), which is the default
 * `secretManager` for {@link PrivacyPoolsV1Protocol}. Kept for reference and for
 * callers that explicitly inject it; not wired by default. The two schemes derive
 * disjoint notes, so switching between them after deposits exist is not supported.
 */
export function SecretManager({
  host: { keystore },
  accountIndex = 0
}: SecretManagerParams): ISecretManager {

  const deriveSecrets = async ({ chainId, entrypointAddress, depositIndex, secretIndex }: DeriveSecretsParams) => {
    const saltSecret = await keystore.deriveAt(ppPath({ accountIndex, secretType: "salt", depositIndex, secretIndex }));
    const nullifierSecret = await keystore.deriveAt(ppPath({ accountIndex, secretType: "nullifier", depositIndex, secretIndex }));
    const nullifier = hashToSnarkField([chainId.toString(), BigInt(entrypointAddress), BigInt(nullifierSecret)]);
    const salt = hashToSnarkField([chainId.toString(), BigInt(entrypointAddress), BigInt(saltSecret)]);
    const precommitment = hashToSnarkField([nullifier, salt]);
    const nullifierHash = hashToSnarkField([nullifier]);

    return { nullifier, salt, precommitment, nullifierHash };
  };

  const getDepositSecrets = ({ entrypointAddress, chainId, depositIndex }: DeriveDepositSecretParams) => {
    return deriveSecrets({ entrypointAddress, chainId, depositIndex, secretIndex: 0 });
  };

  const getSecrets = ({ entrypointAddress, chainId, depositIndex, withdrawIndex }: DeriveWithdrawalSecretsParams) => {
    return deriveSecrets({ entrypointAddress, chainId, depositIndex, secretIndex: withdrawIndex });
  };

  const deriveEphemeralSigner = async ({ chainId, entrypointAddress, depositIndex, withdrawIndex }: DeriveWithdrawalSecretsParams) => {
    const raw = await keystore.deriveAt(ppSignerPath({ accountIndex, depositIndex, withdrawIndex }));
    const key = hashToSnarkField([chainId.toString(), BigInt(entrypointAddress), BigInt(raw)]);

    return `0x${key.toString(16).padStart(64, "0")}` as `0x${string}`;
  };

  // No privacy transform: a classical wallet path yields a real private key whose
  // address is recoverable by the user's own wallet, so a stuck sender can be swept.
  const deriveDelegatorSigner = async ({ path }: { path: string }) => {
    return keystore.deriveAt(path) as Promise<`0x${string}`>;
  };

  return {
    getDepositSecrets,
    getSecrets,
    deriveEphemeralSigner,
    deriveDelegatorSigner,
  };

}

type PrivacyPoolsDerivationPath = {
  accountIndex: number;
  secretType: "salt" | "nullifier";
  depositIndex: number;
  secretIndex: number;
};

// secretType index 2 (0 = nullifier, 1 = salt) reserved for the paymaster
// ephemeral signer, disjoint from the note-secret lineage.
const SIGNER_SECRET_TYPE = 2;

function ppPath({ accountIndex, secretType, depositIndex, secretIndex }: PrivacyPoolsDerivationPath) {
  const _secretType = secretType === "nullifier" ? 0 : 1;

  return `${PRIVACY_POOLS_PATH}/${accountIndex}'/${_secretType}'/${depositIndex}'/${secretIndex}'`;
}

function ppSignerPath({ accountIndex, depositIndex, withdrawIndex }: { accountIndex: number; depositIndex: number; withdrawIndex: number }) {
  return `${PRIVACY_POOLS_PATH}/${accountIndex}'/${SIGNER_SECRET_TYPE}'/${depositIndex}'/${withdrawIndex}'`;
}

function hashToSnarkField(numberLikes: (string | bigint)[]) {
  const _bigints: bigint[] = [];

  for (const n of numberLikes) {
    if (typeof n === 'string') {
      _bigints.push(BigInt(n));
    } else {
      _bigints.push(n);
    }
  }

  return poseidon(_bigints);
}

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

export interface Secret {
  nullifier: bigint;
  salt: bigint;
  precommitment: bigint;
  nullifierHash: bigint;
};

type BaseDeriveSecretParams = {
  entrypointAddress: bigint;
  chainId: bigint;
};

type DeriveDepositSecretParams = BaseDeriveSecretParams & {
  depositIndex: number;
};

type DeriveWithdrawalSecretsParams = BaseDeriveSecretParams & {
  depositIndex: number;
  withdrawIndex: number;
};

type DeriveSecretsParams = BaseDeriveSecretParams & {
  depositIndex: number;
  secretIndex: number;
};

export interface ISecretManager {
  getDepositSecrets: (params: DeriveDepositSecretParams) => Secret;
  getSecrets: (params: DeriveWithdrawalSecretsParams) => Secret;
}

export interface SecretManagerParams {
  host: Host,
  accountIndex?: number;
}

export function SecretManager({
  host: { keystore },
  accountIndex = 0
}: SecretManagerParams): ISecretManager {

  const deriveSecrets = ({ chainId, entrypointAddress, depositIndex, secretIndex }: DeriveSecretsParams) => {
    const saltSecret = keystore.deriveAt(ppPath({ accountIndex, secretType: "salt", depositIndex, secretIndex }));
    const nullifierSecret = keystore.deriveAt(ppPath({ accountIndex, secretType: "nullifier", depositIndex, secretIndex }));
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

  return {
    getDepositSecrets,
    getSecrets
  };

}

type PrivacyPoolsDerivationPath = {
  accountIndex: number;
  secretType: "salt" | "nullifier";
  depositIndex: number;
  secretIndex: number;
};

function ppPath({ accountIndex, secretType, depositIndex, secretIndex }: PrivacyPoolsDerivationPath) {
  const _secretType = secretType === "nullifier" ? 0 : 1;

  return `${PRIVACY_POOLS_PATH}/${accountIndex}'/${_secretType}'/${depositIndex}'/${secretIndex}'`;
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

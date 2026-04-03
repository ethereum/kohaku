import { Host } from '@kohaku-eth/plugins';
import { poseidon } from "maci-crypto/build/ts/hashing.js";
import { Commitment, Nullifier, NullifierHash } from '../interfaces/types.interface';

/** BIP32-BIP43 - Privacy Pools v1
 *   2**31
 *
 * m/purpose'/version'/account'/secretType'/deposit'/secretIndex'
 *   secretIndex: 0 = deposit secret, 1+ = withdrawal secrets
 *   PH[secret(N|C), entrypointAddress] -> circuit
 */

const TORNADO_CASH_PATH = "m/29795'/1'";

export interface Secret {
  nullifier: Nullifier;
  salt: bigint;
  commitment: Commitment;
  nullifierHash: NullifierHash;
};

type BaseDeriveSecretParams = {
  poolAddress: bigint;
  chainId: bigint;
};

type DeriveDepositSecretParams = BaseDeriveSecretParams & {
  depositIndex: number;
};

type DeriveSecretsParams = BaseDeriveSecretParams & {
  depositIndex: number;
};

export interface ISecretManager {
  getDepositSecrets: (params: DeriveDepositSecretParams) => Secret;
}

export interface SecretManagerParams {
  host: Host,
  accountIndex?: number;
}

export function SecretManager({
  host: { keystore },
  accountIndex = 0
}: SecretManagerParams): ISecretManager {

  const deriveSecrets = ({ chainId, poolAddress, depositIndex }: DeriveSecretsParams) => {
    const saltSecret = keystore.deriveAt(ppPath({ accountIndex, secretType: "salt", depositIndex }));
    const nullifierSecret = keystore.deriveAt(ppPath({ accountIndex, secretType: "nullifier", depositIndex }));
    const nullifier = hashToSnarkField([chainId.toString(), BigInt(poolAddress), BigInt(nullifierSecret)]);
    const salt = hashToSnarkField([chainId.toString(), BigInt(poolAddress), BigInt(saltSecret)]);
    const commitment = hashToSnarkField([nullifier, salt]);
    const nullifierHash = hashToSnarkField([nullifier]);

    return { nullifier, salt, commitment, nullifierHash };
  };

  const getDepositSecrets = ({ poolAddress, chainId, depositIndex }: DeriveDepositSecretParams) => {
    return deriveSecrets({ poolAddress, chainId, depositIndex });
  };

  return {
    getDepositSecrets,
  };

}

type PrivacyPoolsDerivationPath = {
  accountIndex: number;
  secretType: "salt" | "nullifier";
  depositIndex: number;
};

function ppPath({ accountIndex, secretType, depositIndex }: PrivacyPoolsDerivationPath) {
  const _secretType = secretType === "nullifier" ? 0 : 1;

  return `${TORNADO_CASH_PATH}/${accountIndex}'/${_secretType}'/${depositIndex}'`;
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

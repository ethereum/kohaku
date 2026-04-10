import { buildBabyjub, buildPedersenHash } from 'circomlibjs';
import { Host } from '@kohaku-eth/plugins';
import { Commitment, Nullifier, NullifierHash } from '../interfaces/types.interface';

/** BIP32-BIP43 - Privacy Pools v1
 *   2**31
 *
 * m/purpose'/version'/account'/secretType'/deposit'/secretIndex'
 *   secretIndex: 0 = deposit secret, 1+ = withdrawal secrets
 *   PH[secret(N|C), entrypointAddress] -> circuit
 */

const TORNADO_CASH_PATH = "m/29795'/1'";

// Tornado circuits constrain nullifier and secret to 248 bits (31 bytes).
// Pedersen outputs are Baby JubJub x-coordinates (~254 bits), so we truncate.
const MASK_248 = (1n << 248n) - 1n;

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

function toBytesLE(n: bigint, byteLength: number): Uint8Array {
  const buf = new Uint8Array(byteLength);

  for (let i = 0; i < byteLength; i++) buf[i] = Number((n >> BigInt(i * 8)) & 0xffn);

  return buf;
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

export async function SecretManager({
  host: { keystore },
  accountIndex = 0
}: SecretManagerParams): Promise<ISecretManager> {
  // Load WASM eagerly — done once, all subsequent getDepositSecrets calls are sync
  const babyjub = await buildBabyjub();
  const pedersen = await buildPedersenHash();

  function pedersenHash(data: Uint8Array): bigint {
    const hash = pedersen.hash(data, { baseHash: 'blake2b' });
    const [x] = babyjub.unpackPoint(hash);

    return babyjub.F.toObject(x);
  }

  const deriveSecrets = ({ chainId, poolAddress, depositIndex }: DeriveSecretsParams): Secret => {
    const saltSecret = keystore.deriveAt(ppPath({ accountIndex, secretType: "salt", depositIndex }));
    const nullifierSecret = keystore.deriveAt(ppPath({ accountIndex, secretType: "nullifier", depositIndex }));

    // Domain separation via chained Pedersen: hash secret with chainId, then hash with poolAddress.
    // Truncated to 248 bits to satisfy the tornado circuit constraint.
    const nullifierWithChain = pedersenHash(concat(toBytesLE(BigInt(nullifierSecret), 32), toBytesLE(chainId, 8)));
    const nullifier = pedersenHash(concat(toBytesLE(nullifierWithChain, 32), toBytesLE(poolAddress, 20))) & MASK_248;

    const saltWithChain = pedersenHash(concat(toBytesLE(BigInt(saltSecret), 32), toBytesLE(chainId, 8)));
    const salt = pedersenHash(concat(toBytesLE(saltWithChain, 32), toBytesLE(poolAddress, 20))) & MASK_248;

    const nullifierBytes = toBytesLE(nullifier, 31);
    const preimage = new Uint8Array(62);

    preimage.set(nullifierBytes, 0);
    preimage.set(toBytesLE(salt, 31), 31);

    const commitment    = pedersenHash(preimage);
    const nullifierHash = pedersenHash(nullifierBytes);

    return { nullifier, salt, commitment, nullifierHash };
  };

  return {
    getDepositSecrets: (params) => deriveSecrets(params),
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

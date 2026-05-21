import { Host } from '@kohaku-eth/plugins';
import { Commitment, Nullifier, NullifierHash } from '../interfaces/types.interface';
import { pedersenHash } from '../utils/proof.util';

/** BIP32-BIP43 - Tornado Cash
 *   2**31
 *
 * m/purpose'/version'/account'/secretType'/deposit'
 *   secretType: 0 = nullifier, 1 = salt, 2 = signer
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
  getDepositSecrets: (params: DeriveDepositSecretParams) => Promise<Secret>;
  deriveEphemeralSigner: (index: number) => Promise<`0x${string}`>;
}

export interface SecretManagerParams {
  host: Pick<Host, 'keystore'>,
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
  const deriveSecrets = async ({ chainId, poolAddress, depositIndex }: DeriveSecretsParams): Promise<Secret> => {
    // Promise.resolve handles both sync Hex (real keystore) and Promise<Hex> (Comlink proxy)
    const saltSecret = await Promise.resolve(keystore.deriveAt(tcPath({ accountIndex, secretType: "salt", depositIndex })));
    const nullifierSecret = await Promise.resolve(keystore.deriveAt(tcPath({ accountIndex, secretType: "nullifier", depositIndex })));

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

    const commitment = pedersenHash(preimage);
    const nullifierHash = pedersenHash(nullifierBytes);

    return { nullifier, salt, commitment, nullifierHash };
  };

  const deriveEphemeralSigner = async (index: number) => {
    const path = tcPath({ accountIndex, secretType: "signer", depositIndex: index });
    return Promise.resolve(keystore.deriveAt(path));
  };

  return {
    getDepositSecrets: (params) => deriveSecrets(params),
    deriveEphemeralSigner,
  };
}

type TorandoCashDerivationPath = {
  accountIndex: number;
  secretType: "salt" | "nullifier" | "signer";
  depositIndex: number;
};

function tcPath({ accountIndex, secretType, depositIndex }: TorandoCashDerivationPath) {
  const _secretType = {
    "nullifier": 0,
    "salt": 1,
    "signer": 2,
  }[secretType];
  return `${TORNADO_CASH_PATH}/${accountIndex}'/${_secretType}'/${depositIndex}'`;
}

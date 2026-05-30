import { Host } from '@kohaku-eth/plugins';
import { bytesToNumberLE, concatBytes as concat, numberToBytesLE } from "@noble/curves/utils.js";
import { keccak_256 } from "@noble/hashes/sha3.js";

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
  deriveEphemeralSigner: (params: DeriveDepositSecretParams) => Promise<`0x${string}`>;
}

export interface SecretManagerParams {
  host: Pick<Host, 'keystore'>,
  accountIndex?: number;
}

interface CoalesceSecretParams {

  /**
   * randomly derived secret. 32 bytes, excess is truncated.
   */
  secret: `0x${string}`;
  /**
   * Chain id. 8 bytes, excess is truncated.
   */
  chainId: bigint;
  /**
   * EVM address as bigint. 20 bytes, excess is truncated.
   */
  poolAddress: bigint;
}

/**
 * Takes a random secret potentially derived from a bip32 path and hashes it with unique context
 * information, chainId and poolAddress, so it's impossible for the user to accidentally dox
 * themselves, while still allowing deterministic secrets.
 *
 * @returns bigint (256 bits)
 */
function coalesceSecret({ secret, chainId, poolAddress }: CoalesceSecretParams): bigint {
  return bytesToNumberLE(
    keccak_256(
      concat(
        numberToBytesLE(BigInt(secret), 32),
        numberToBytesLE(chainId, 8),
        numberToBytesLE(poolAddress, 20)
      )
    )
  );
}

export async function SecretManager({
  host: { keystore },
  accountIndex = 0
}: SecretManagerParams): Promise<ISecretManager> {
  const deriveSecrets = async ({ chainId, poolAddress, depositIndex }: DeriveSecretsParams): Promise<Secret> => {
    // Promise.resolve handles both sync Hex (real keystore) and Promise<Hex> (Comlink proxy)
    const saltSecretRaw = await Promise.resolve(keystore.deriveAt(tcPath({ accountIndex, secretType: "salt", depositIndex })));
    const nullifierSecretRaw = await Promise.resolve(keystore.deriveAt(tcPath({ accountIndex, secretType: "nullifier", depositIndex })));

    // Truncated to 248 bits to satisfy the tornado circuit constraint.
    const salt = coalesceSecret({ secret: saltSecretRaw, chainId, poolAddress }) & MASK_248;
    const nullifier = coalesceSecret({ secret: nullifierSecretRaw, chainId, poolAddress }) & MASK_248;

    const nullifierBytes = numberToBytesLE(nullifier, 31);
    const preimage = new Uint8Array(62);

    preimage.set(nullifierBytes, 0);
    preimage.set(numberToBytesLE(salt, 31), 31);

    const commitment = pedersenHash(preimage);   // 496 bits == 62 bytes
    const nullifierHash = pedersenHash(nullifierBytes);  // 248 == 31 bytes

    return { nullifier, salt, commitment, nullifierHash };
  };

  const deriveEphemeralSigner = async ({ chainId, poolAddress, depositIndex }: DeriveDepositSecretParams) => {
    const path = tcPath({ accountIndex, secretType: "signer", depositIndex });
    const raw = await Promise.resolve(keystore.deriveAt(path));
    const coalesced = coalesceSecret({ secret: raw, chainId, poolAddress });
    return `0x${coalesced.toString(16).padStart(64, '0')}` as `0x${string}`;
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

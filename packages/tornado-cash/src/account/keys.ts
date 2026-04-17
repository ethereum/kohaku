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

// Base points for the circomlib v2.0.5 Pedersen hash circuit, generated with Blake1/256.
// These are hardcoded in the circuit's pedersen.circom as BASE[10][2].
// We pre-seed the circomlibjs instance with these to avoid calling blake1, which is
// not browser-compatible. Pedersen(248) needs indices 0-1; Pedersen(496) needs 0-2.
const PEDERSEN_BASE_POINTS: [bigint, bigint][] = [
  [10457101036533406547632367118273992217979173478358440826365724437999023779287n, 19824078218392094440610104313265183977899662750282163392862422243483260492317n],
  [2671756056509184035029146175565761955751135805354291559563293617232983272177n,   2663205510731142763556352975002641716101654201788071096152948830924149045094n],
  [5802099305472655231388284418920769829666717045250560929368476121199858275951n,   5980429700218124965372158798884772646841287887664001482443826541541529227896n],
];

export async function SecretManager({
  host: { keystore },
  accountIndex = 0
}: SecretManagerParams): Promise<ISecretManager> {
  // Load WASM eagerly — done once, all subsequent getDepositSecrets calls are sync
  const babyjub = await buildBabyjub();
  const pedersen = await buildPedersenHash();

  // Pre-seed the base-point cache so the hash function never calls blake1 (not
  // browser-compatible).  circomlibjs checks `this.bases[i]` before computing,
  // so injecting the circuit's hardcoded Edwards-form points here is sufficient.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pedersenAny = pedersen as any;

  pedersenAny.bases = PEDERSEN_BASE_POINTS.map(
    ([x, y]) => [pedersenAny.babyJub.F.e(x), pedersenAny.babyJub.F.e(y)],
  );

  function pedersenHash(data: Uint8Array): bigint {
    const hash = pedersen.hash(data);
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

import type { EthereumProvider } from '@kohaku-eth/provider';
import { concat, decodeFunctionResult, encodeFunctionData, numberToHex, pad, toHex, type Address, type Hex } from 'viem';
import { generatePrivateKey } from 'viem/accounts';
import type { SerializedAuth } from '../interfaces/user-ops.interface';

/**
 * Bundler gas estimation only ever sees non-executable payloads: a dummy
 * account signature and 7702 authorization, and dummy Groth16 proofs that
 * only verify against the verifier override below. The real proofs and
 * signatures are produced after estimation and leave the SDK only on broadcast.
 */

// Well-formed (low s) ECDSA components that recover to an unrelated address.
const DUMMY_R: Hex = '0xfffffffffffffffffffffffffffffff000000000000000000000000000000000';
const DUMMY_S: Hex = '0x7aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

/** UserOp signature that no account accepts. */
export const DUMMY_SIGNATURE: Hex = concat([DUMMY_R, DUMMY_S, '0x1c']);

/** Authorization for the real delegate and nonce with an unrelated signature. */
export const dummyAuthorization = (address: Address, chainId: number, nonce: bigint): SerializedAuth => ({
  address,
  chainId: toHex(chainId),
  nonce: toHex(nonce),
  r: DUMMY_R,
  s: DUMMY_S,
  yParity: '0x1',
});

const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Random public input for values that would otherwise link the note (nullifier, commitment). */
export const randomFieldElement = (): bigint => BigInt(generatePrivateKey()) % SNARK_SCALAR_FIELD;

// Valid BN254 points, so the verifier's precompile calls cost what a real proof's do:
// A = C = 2·G1 and B = G2 generator, in Solidity order (Fp2 coordinates imaginary first).
const TWO_G1 = [
  1368015179489954701390400359078579693043519447331113978918064868415326638035n,
  9918110051302171585080402603319702774565515993150576347155970296011118125764n,
] as const;
const G2 = [
  11559732032986387107991004021392285783925812861821192530917403151452391805634n,
  10857046999023057135944570762232829481370756359578518086990519993285655852781n,
  4082367875863433681332203403145435568316851327593401208105741076214120093531n,
  8495653923123431417604973247489272438418190587263600148770280649306958101930n,
] as const;

/** Packed `bytes` Groth16 proof as Tornado's verifier expects it. */
export const DUMMY_PROOF: Hex = concat([...TWO_G1, ...G2, ...TWO_G1].map((x) => numberToHex(x, { size: 32 })));

/** Mock address a verifier's code is moved to: "Kohaku" plus an index. */
const SHADOW_VERIFIER = 0x4b6f68616b75n;

/** Code that staticcalls `target` with the same calldata, discards the outcome and returns `true`. */
export const verifierForwarder = (target: Address): Hex =>
  concat(['0x3660006000376000600036600073', target, '0x5afa50600160005260206000f3']);

/** Bundler `stateOverrides` (third `eth_estimateUserOperationGas` parameter). */
export type StateOverrides = Record<Address, { code: Hex }>;

const verifierAbi = [{ type: 'function', name: 'verifier', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const;

/**
 * Overrides each pool's verifier to accept any proof while still running the
 * real verifier, so the estimate holds once proven. The forwarder adds about
 * 3k gas per verification, so estimates err slightly high.
 */
export async function verifierOverrides(provider: Pick<EthereumProvider, 'request'>, pools: Address[]): Promise<StateOverrides> {
  const verifiers = new Set<Address>();

  for (const pool of pools) {
    const result = await provider.request({ method: 'eth_call', params: [{ to: pool, data: encodeFunctionData({ abi: verifierAbi, functionName: 'verifier' }) }, 'latest'] });

    verifiers.add(decodeFunctionResult({ abi: verifierAbi, functionName: 'verifier', data: result as Hex }).toLowerCase() as Address);
  }

  const overrides: StateOverrides = {};
  let index = 0n;

  for (const verifier of verifiers) {
    const code = await provider.request({ method: 'eth_getCode', params: [verifier, 'latest'] });

    if (typeof code !== 'string' || !/^0x([0-9a-f]{2})+$/i.test(code)) throw new Error(`Tornado verifier ${verifier} has no code`);

    const shadow = pad(toHex(SHADOW_VERIFIER + index++), { size: 20 });

    overrides[shadow] = { code: code as Hex };
    overrides[verifier] = { code: verifierForwarder(shadow) };
  }

  return overrides;
}

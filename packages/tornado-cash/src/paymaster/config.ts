import { encodeAbiParameters, parseAbiParameters } from 'viem';
import type { IPaymasterConfig } from '../plugin/interfaces/protocol-params.interface';
import type { TornadoProveOutput } from '../utils/tornado-prover';

export function findPoolPaymaster(config: IPaymasterConfig, pool: bigint) {
  return config.supportedPools.some((address) => BigInt(address) === pool)
    ? config.paymasterAddress
    : undefined;
}

/** Reject a pool that this paymaster has not allowlisted. */
export function resolvePoolPaymaster(config: IPaymasterConfig, pool: bigint) {
  const address = findPoolPaymaster(config, pool);

  if (address) return address;

  throw new Error(`No Tornado paymaster configured for pool 0x${pool.toString(16)}`);
}

export function encodePoolPaymasterData(
  pool: bigint,
  proof: TornadoProveOutput,
): `0x${string}` {
  const [root, nullifierHash, recipient, , fee] = proof.args;

  return encodeAbiParameters(
    parseAbiParameters('(address instance, bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, uint256 fee)'),
    [{ instance: `0x${pool.toString(16).padStart(40, '0')}`, proof: proof.proof, root, nullifierHash, recipient, fee: BigInt(fee) }],
  );
}

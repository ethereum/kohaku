import type { SignedAuthorization, Hash } from 'viem';
import { TornadoProveOutput } from '../../utils/tornado-prover';
import { Address } from '../../interfaces/types.interface';
import { SerializedUserOperation } from '../../interfaces/user-ops.interface';

export interface SignedDelegation {
  senderAddress: `0x${string}`;
  authorization: SignedAuthorization;
}

export interface IPaymasterWithdrawalPayload {
  mode: 'paymaster';
  proof: TornadoProveOutput;
  poolAddress: Address;
  isERC20: boolean;
  delegation?: SignedDelegation;
}

export interface IGenericPaymasterWithdrawalPayload {
  mode: 'paymaster';
  proof: TornadoProveOutput;
  poolAddress: Address;
  isERC20: boolean;
  paymasterAddress: `0x${string}`;
  entryPointAddress: `0x${string}`;
  bundlerUrl: string;
  /** Total value of the deposits spent, before the sponsored gas fee. */
  withdrawnValue: bigint;
  /** Sponsored gas fee bound in the sponsoring proof, in the pool asset's base units. */
  fee: bigint;
  // The fully built and signed userOp, produced in the prepare phase. The
  // broadcaster only relays it to the bundler.
  userOperation: SerializedUserOperation;
}

export interface PaymasterBroadcastResult {
  userOpHash: Hash;
}

export interface IPaymasterBroadcasterClient {
    broadcast(
        withdrawals: IPaymasterWithdrawalPayload[],
    ): Promise<PaymasterBroadcastResult[]>
}
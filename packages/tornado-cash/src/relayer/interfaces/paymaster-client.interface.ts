import type { SignedAuthorization, Hash } from 'viem';
import { TornadoProveOutput } from '../../utils/tornado-prover';
import { Address } from '../../interfaces/types.interface';
import type { SerializedUserOperation } from '../../paymaster/utils';

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
import type { SignedAuthorization, Hash } from 'viem';
import { TornadoProveOutput } from '../../utils/tornado-prover';
import { Address } from '../../interfaces/types.interface';

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
  accountAddress: `0x${string}`;
  delegation?: SignedDelegation;
}

export interface PaymasterBroadcastResult {
  userOpHash: Hash;
}

export interface IPaymasterBroadcasterClient {
    broadcast(
        withdrawals: IPaymasterWithdrawalPayload[],
    ): Promise<PaymasterBroadcastResult[]>
}
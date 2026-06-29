import { TxData } from "@kohaku-eth/provider";
import { Address } from "ox/Address";
import { Hex } from "ox/Hex";

export interface SerializedAuth {
    address: Address;
    chainId: Hex;
    nonce: Hex
    r: Hex;
    s: Hex;
    yParity: Hex;
}


/**
 * A userOp serialized to the hex shape expected by `eth_sendUserOperation`, so
 * it can be carried as plain (JSON-serializable) data from the prepare phase
 * (thunk) to the broadcast phase.
 */
export interface SerializedUserOperation {
  sender: `0x${string}`;
  nonce: `0x${string}`;
  callData: `0x${string}`;
  callGasLimit: `0x${string}`;
  verificationGasLimit: `0x${string}`;
  preVerificationGas: `0x${string}`;
  maxFeePerGas: `0x${string}`;
  maxPriorityFeePerGas: `0x${string}`;
  paymaster?: `0x${string}`;
  paymasterVerificationGasLimit?: `0x${string}`;
  paymasterPostOpGasLimit?: `0x${string}`;
  paymasterData?: `0x${string}`;
  signature: `0x${string}`;
  eip7702Auth?: SerializedAuth;
}

export interface UserOpGasLimits {
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
}

export interface BuildSignedTornadoUserOpParams {
  privateKey: Hex;
  chainId: number;
  paymasterAddress: Address;
  paymasterData: Hex;
  gas: UserOpGasLimits;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  tailCalls?: (address: Address) => Promise<TxData[]>;
  /** EntryPoint nonce for this sender. Defaults to 0 (fresh EOA). Set to the
   *  deposit index when multiple userOps share the same ephemeral sender. */
  nonce?: bigint;
}
import { Wallet, AbiCoder } from 'ethers';
import { WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { keccak256 } from 'ethereum-cryptography/keccak';
import type { TokenData } from '../railgun-logic/logic/note';
import type { TxData, ActionData } from './types';

/**
 * Creates a WalletNode from a private key string.
 *
 * @param priv - The private key as a hex string
 * @returns A new WalletNode instance with the derived chain key
 */
export const getWalletNodeFromKey = (priv: string): WalletNode => {
  const wallet = new Wallet(priv);
  return new WalletNode({chainKey: wallet.privateKey, chainCode: ''});
};

/**
 * Creates a TokenData object for an ERC20 token.
 *
 * @param token - The ERC20 token contract address
 * @returns TokenData object with tokenType set to 0 (ERC20) and the provided address
 */
export const getERC20TokenData = (token: string): TokenData => {
  const tokenData = {
    tokenType: 0,
    tokenAddress: token,
    tokenSubID: 0n,
  };
  return tokenData;
}

/**
 * Creates a TxData object for transaction construction.
 *
 * @param address - The target contract address
 * @param payload - The encoded function call data
 * @param value - The ETH value to send with the transaction
 * @default BigInt(0)
 * @returns TxData object ready for transaction submission
 */
export const getTxData = (address: string, payload: string, value: bigint = BigInt(0)): TxData => {
  return {
    to: address,
    data: payload,
    value: value,
  };
}

/**
 * Converts ActionData object to tuple format for ABI encoding.
 *
 * @param a - The ActionData object to convert
 * @returns Array tuple representation suitable for ABI encoding
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toActionDataTuple(a: ActionData): any[] {
  const callsTuple = a.calls.map((c) => [
    c.to,
    c.data ?? '0x',
    c.value ?? 0n,
  ]);
  return [a.random, a.requireSuccess, a.minGasLimit, callsTuple];
}

/**
 * Generates a hash of adapt parameters for relay transactions.
 *
 * @param nullifiers - 2D array of nullifier strings for each tree
 * @param actionData - The action data containing calls and execution parameters
 * @returns Keccak256 hash of the encoded parameters
 */
export function getAdaptParamsHash(
  nullifiers: string[][],
  actionData: ActionData
): Uint8Array {
  const coder = new AbiCoder();
  const encoded = coder.encode(
    ['bytes32[][]', 'uint256', 'tuple(bytes31,bool,uint256,tuple(address,bytes,uint256)[])'],
    [nullifiers, BigInt(nullifiers.length), toActionDataTuple(actionData)]
  );

  return keccak256(ByteUtils.hexToBytes(encoded));
}

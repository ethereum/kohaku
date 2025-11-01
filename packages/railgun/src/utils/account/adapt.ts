import { AbiCoder } from 'ethers';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { ByteUtils } from '../../railgun/lib/utils/bytes';

export type Call = {
  to: string;
  data: string;
  value: bigint | number | string;
};

export type ActionData = {
  random: string;
  requireSuccess: boolean;
  minGasLimit: bigint | number | string;
  calls: Call[];
};

export const toActionDataTuple = (a: ActionData): [string, boolean, bigint | number | string, Array<[string, string, bigint | number | string]>] => {
  const callsTuple = a.calls.map((c): [string, string, bigint | number | string] => [
    c.to,
    c.data ?? '0x',
    c.value ?? 0n,
  ]);

  return [a.random, a.requireSuccess, a.minGasLimit, callsTuple];
};

export const getAdaptParamsHash = (
  nullifiers: string[][],
  actionData: ActionData,
): Uint8Array => {
  const coder = new AbiCoder();
  const encoded = coder.encode(
    ['bytes32[][]', 'uint256', 'tuple(bytes31,bool,uint256,tuple(address,bytes,uint256)[])'],
    [nullifiers, BigInt(nullifiers.length), toActionDataTuple(actionData)],
  );

  return keccak256(ByteUtils.hexToBytes(encoded));
};

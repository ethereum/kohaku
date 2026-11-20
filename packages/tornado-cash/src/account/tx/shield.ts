import { createTx, TxData } from '@kohaku-eth/provider';
import { encodeFunctionData, toHex } from "viem";
import { poolAbi } from '../../data/abis/pool.abi';
import { approvalTxs } from './approve';

type PrepareNativeShieldParam = {
  commitment: bigint;
  poolAddress: string;
  poolDenomination: bigint;
};

type PrepareErc20ShieldParam = {
  commitment: bigint;
  tokenAddress: string;
  poolAddress: string;
  denomination: bigint;
};

export function prepareNativeShield({ commitment, poolAddress, poolDenomination }: PrepareNativeShieldParam): TxData {
  const data = encodeFunctionData({
    abi: poolAbi,
    functionName: 'deposit',
    args: [toHex(commitment, { size: 32 })],
  });

  return createTx(poolAddress, data, poolDenomination);
}

export function prepareErc20Shield({ commitment, tokenAddress, poolAddress, denomination }: PrepareErc20ShieldParam): TxData[] {
  const depositData = encodeFunctionData({
    abi: poolAbi,
    functionName: 'deposit',
    args: [toHex(commitment, { size: 32 })],
  });

  return [
    ...approvalTxs(tokenAddress, poolAddress, denomination),
    createTx(poolAddress, depositData),
  ];
}

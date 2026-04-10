import { createTx, TxData } from '@kohaku-eth/provider';
import { encodeFunctionData, toHex } from "viem";
import { poolAbi } from '../../data/abis/pool.abi';
import { erc20Abi } from 'viem';

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
  const approveData = encodeFunctionData({
    abi: erc20Abi,
    functionName: 'approve',
    args: [poolAddress as `0x${string}`, denomination],
  });

  const depositData = encodeFunctionData({
    abi: poolAbi,
    functionName: 'deposit',
    args: [toHex(commitment, { size: 32 })],
  });

  return [
    createTx(tokenAddress, approveData),
    createTx(poolAddress, depositData),
  ];
}

import { createTx, TxData } from '@kohaku-eth/provider';
import { Address, encodeFunctionData } from "viem";
import { Commitment } from '../types';
import { entrypointDepositErc20Abi, entrypointDepositNativeAbi } from '../../data/abis/instance-registry.abi';

export type ShieldFn = (token: Address, value: bigint) => { commitment: Commitment; tx: TxData; };
export type Shield = { shield: ShieldFn; };

type PrepareNativeShieldParam = {
  commitment: bigint;
  poolAddress: string;
};

type PrepareErc20ShieldParam = {
  commitment: bigint;
  tokenAddress: string;
  poolAddress: string;
};

export function prepareNativeShield({ commitment, poolAddress }: PrepareNativeShieldParam) {
  const data = encodeFunctionData({
    abi: entrypointDepositNativeAbi,
    functionName: 'deposit',
    args: [commitment]
  });

  return createTx(poolAddress, data);
}

export function prepareErc20Shield({ commitment, tokenAddress, poolAddress }: PrepareErc20ShieldParam) {
  const data = encodeFunctionData({
    abi: entrypointDepositErc20Abi,
    functionName:'deposit',
    args: [tokenAddress as `0x${string}`, commitment]
  });

  return createTx(poolAddress, data);
}

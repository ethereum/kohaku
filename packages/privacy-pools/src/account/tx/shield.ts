import { createTx, TxData } from '@kohaku-eth/provider';
import { Address, encodeFunctionData } from "viem";
import { Commitment } from '../types';
import { entrypointDepositErc20Abi, entrypointDepositNativeAbi } from '../../data/abis/entrypoint.abi';

export type ShieldFn = (token: Address, value: bigint) => { commitment: Commitment; tx: TxData; };
export type Shield = { shield: ShieldFn; };

type PrepareNativeShieldParam = {
  precommitment: bigint;
  amount: bigint;
  entrypointAddress: string;
};

type PrepareErc20ShieldParam = {
  precommitment: bigint;
  amount: bigint;
  tokenAddress: string;
  entrypointAddress: string;
};

export function prepareNativeShield({ precommitment, amount, entrypointAddress }: PrepareNativeShieldParam) {
  const data = encodeFunctionData({
    abi: entrypointDepositNativeAbi,
    functionName: 'deposit',
    args: [precommitment]
  });

  return createTx(entrypointAddress, data, amount);
}

export function prepareErc20Shield({ precommitment, amount, tokenAddress, entrypointAddress }: PrepareErc20ShieldParam) {
  const data = encodeFunctionData({
    abi: entrypointDepositErc20Abi,
    functionName:'deposit',
    args: [tokenAddress as `0x${string}`, amount, precommitment]
  });

  return createTx(entrypointAddress, data);
}

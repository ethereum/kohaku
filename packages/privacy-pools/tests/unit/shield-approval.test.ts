import { decodeFunctionData, erc20Abi } from 'viem';
import { describe, expect, it } from 'vitest';

import { prepareErc20Shield, prepareNativeShield } from '../../src/account/tx/shield';
import { entrypointDepositErc20Abi } from '../../src/data/abis/entrypoint.abi';

const ENTRYPOINT = '0x6818809eefce719e480a7526d76bd3e561526b46';
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const approvals = (txns: { to: string; data: string }[], token: string) => txns
  .filter(({ to }) => to.toLowerCase() === token.toLowerCase())
  .map(({ data }) => decodeFunctionData({ abi: erc20Abi, data: data as `0x${string}` }).args)
  .map(([spender, amount]) => [String(spender).toLowerCase(), amount]);

describe('Privacy Pools shield plan', () => {
  it('approves exactly the deposited amount for the entrypoint, then deposits', () => {
    const txns = prepareErc20Shield({ precommitment: 7n, amount: 100n, tokenAddress: USDC, entrypointAddress: ENTRYPOINT });

    expect(txns.map(({ to }) => to.toLowerCase())).toEqual([USDC, ENTRYPOINT]);
    expect(approvals(txns, USDC)).toEqual([[ENTRYPOINT, 100n]]);
    const [token, amount, precommitment] = decodeFunctionData({ abi: entrypointDepositErc20Abi, data: txns[1]!.data as `0x${string}` }).args;

    expect([token.toLowerCase(), amount, precommitment]).toEqual([USDC, 100n, 7n]);
  });

  it('resets a reset-required token allowance before approving, whatever the address case', () => {
    for (const token of [USDT, USDT.toLowerCase()]) {
      const txns = prepareErc20Shield({ precommitment: 7n, amount: 100n, tokenAddress: token, entrypointAddress: ENTRYPOINT });

      expect(txns).toHaveLength(3);
      expect(approvals(txns, USDT)).toEqual([[ENTRYPOINT, 0n], [ENTRYPOINT, 100n]]);
      expect(txns[2]!.to.toLowerCase()).toBe(ENTRYPOINT);
    }
  });

  it('keeps a native deposit to one transaction with the amount as value', () => {
    expect(prepareNativeShield({ precommitment: 7n, amount: 100n, entrypointAddress: ENTRYPOINT })).toMatchObject({ to: ENTRYPOINT, value: 100n });
  });
});

import { decodeFunctionData, erc20Abi } from 'viem';
import { describe, expect, it } from 'vitest';

import { prepareErc20Shield } from '../../src/account/tx/shield';

const POOL = '0x169ad27a470d064dede56a2d3ff727986b15d52b';
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const approvals = (txns: { to: string; data: string }[], token: string) => txns
  .filter(({ to }) => to.toLowerCase() === token.toLowerCase())
  .map(({ data }) => decodeFunctionData({ abi: erc20Abi, data: data as `0x${string}` }).args)
  .map(([spender, amount]) => [String(spender).toLowerCase(), amount]);

describe('Tornado shield plan', () => {
  it('approves the denomination for the pool, then deposits', () => {
    const txns = prepareErc20Shield({ commitment: 7n, tokenAddress: DAI, poolAddress: POOL, denomination: 100n });

    expect(txns.map(({ to }) => to.toLowerCase())).toEqual([DAI, POOL]);
    expect(approvals(txns, DAI)).toEqual([[POOL, 100n]]);
  });

  it('resets a reset-required token allowance before approving', () => {
    const txns = prepareErc20Shield({ commitment: 7n, tokenAddress: USDT, poolAddress: POOL, denomination: 100n });

    expect(txns).toHaveLength(3);
    expect(approvals(txns, USDT)).toEqual([[POOL, 0n], [POOL, 100n]]);
    expect(txns[2]!.to.toLowerCase()).toBe(POOL);
  });
});

import { decodeAbiParameters, parseAbiParameters } from 'viem';
import { describe, expect, it } from 'vitest';
import { TornadoPaymasterConfigs } from '../../src/config';
import { encodePoolPaymasterData, resolvePoolPaymaster } from '../../src/paymaster/config';
import type { TornadoProveOutput } from '../../src/utils/tornado-prover';

const proof: TornadoProveOutput = {
  proof: '0x1234',
  args: [
    `0x${'11'.repeat(32)}`,
    `0x${'22'.repeat(32)}`,
    '0x0000000000000000000000000000000000000003',
    '0x0000000000000000000000000000000000000004',
    '0x05',
    '0x00',
  ],
};

describe('Tornado paymaster pool routing', () => {
  it('selects the new paymaster and its direct ABI for every deployed pool', () => {
    for (const chainId of [1, 11155111] as const) {
      const config = TornadoPaymasterConfigs[chainId];

      for (const address of config.supportedPools) {
        const pool = BigInt(address);
        const paymaster = resolvePoolPaymaster(config, pool);

        expect(paymaster).toBe(config.paymasterAddress);

        const [data] = decodeAbiParameters(
          parseAbiParameters('(address instance, bytes proof, bytes32 root, bytes32 nullifierHash, address recipient, uint256 fee)'),
          encodePoolPaymasterData(pool, proof),
        );

        expect(BigInt(data.instance)).toBe(pool);
        expect(data.proof).toBe(proof.proof);
        expect(data.recipient).toBe(proof.args[2]);
        expect(data.fee).toBe(5n);
      }
    }
  });

  it('rejects a pool with no paymaster configuration', () => {
    expect(() => resolvePoolPaymaster(TornadoPaymasterConfigs[1], 0xdeadn))
      .toThrow('No Tornado paymaster configured');
  });
});

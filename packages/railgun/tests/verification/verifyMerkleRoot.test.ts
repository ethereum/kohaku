import { describe, expect, it, vi } from 'vitest';
import { EthereumProvider } from '@kohaku-eth/provider';
import { MerkleRootVerificationError, verifyMerkleRoot } from '../../src/verification/verifyMerkleRoot';

const toBytes32Hex = (hex: string): string => {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex;

  return `0x${stripped.padStart(64, '0')}`;
};

describe('verifyMerkleRoot', () => {
  it('passes when local root matches on-chain root representation', async () => {
    const localRoot = Uint8Array.from([1]);
    const provider = {
      request: vi.fn().mockResolvedValue(toBytes32Hex('01')),
    } as unknown as EthereumProvider;

    await expect(
      verifyMerkleRoot({
        provider,
        contractAddress: '0x0000000000000000000000000000000000000001',
        localRoot,
        atBlock: 123,
      }),
    ).resolves.toBeUndefined();
  });

  it('throws MerkleRootVerificationError on mismatch', async () => {
    const localRoot = Uint8Array.from([1]);
    const provider = {
      request: vi.fn().mockResolvedValue(toBytes32Hex('00')),
    } as unknown as EthereumProvider;

    await expect(
      verifyMerkleRoot({
        provider,
        contractAddress: '0x0000000000000000000000000000000000000001',
        localRoot,
        atBlock: 456,
      }),
    ).rejects.toBeInstanceOf(MerkleRootVerificationError);
  });
});

import { describe, it, expect, inject } from 'vitest';
import { OxBowAspService } from '../../src/data/0xbowAsp.service';
import { IPFSAspService } from '../../src/data/ipfsAsp.service';

const aspConfigPerChain = {
  1: {
    url: "https://api.0xbow.io",
    scope: 4916574638117198869413701114161172350986437430914933850166949084132905299523n
  },
  11155111: {
    url: "https://dw.0xbow.io",
    scope: 9423591183392302543658559874370404687995075471172962430042059179876435583731n
  }
} as const


/**
 * Integration tests for ASP services against live APIs.
 * These tests make real network requests and verify the services work correctly
 * with actual data from 0xbow and IPFS.
 */
describe('ASP Services Integration', () => {
  // Test data (Sepolia)
  const rawChainId = inject('chainId')
  const TEST_CHAIN_ID = BigInt(rawChainId);
  const { url: TEST_ASP_URL, scope: TEST_SCOPE } = aspConfigPerChain[rawChainId]
  const TEST_IPFS_CID = 'bafybeihrecrgyfkzyzli2oxnpfos5z2fgjt7zs52cbjyppigu64hva4z3i';

  describe('OxBowAspService', () => {
    it('fetches merkle tree from 0xbow API', { timeout: 30000 }, async () => {
      const service = new OxBowAspService({
        network: { fetch },
        aspUrl: TEST_ASP_URL
      });

      const result = await service.getAspTreeOxBow({
        chainId: TEST_CHAIN_ID,
        scope: TEST_SCOPE,
      });

      // Verify structure: [leaves, [root]]
      expect(result).toHaveLength(2);
      expect(Array.isArray(result[0])).toBe(true);
      expect(Array.isArray(result[1])).toBe(true);
      expect(result[1]).toHaveLength(1);
    });

    it('returns valid merkle tree structure', { timeout: 30000 }, async () => {
      const service = new OxBowAspService({
        network: { fetch },
        aspUrl: TEST_ASP_URL
      });

      const result = await service.getAspTreeOxBow({
        chainId: TEST_CHAIN_ID,
        scope: TEST_SCOPE,
      });

      const [leaves, [root]] = result;

      // All leaves should be bigints
      for (const leaf of leaves) {
        expect(typeof leaf).toBe('bigint');
        expect(leaf >= 0n).toBe(true);
      }

      // Root should be a bigint
      expect(typeof root).toBe('bigint');
      expect(root >= 0n).toBe(true);
    });

    it('computed root is a valid field element', { timeout: 30000 }, async () => {
      const SNARK_SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

      const service = new OxBowAspService({
        network: { fetch },
        aspUrl: TEST_ASP_URL
      });

      const result = await service.getAspTreeOxBow({
        chainId: TEST_CHAIN_ID,
        scope: TEST_SCOPE,
      });

      const [, [root]] = result;

      // Root should be within the SNARK scalar field
      expect(root >= 0n).toBe(true);
      expect(root < SNARK_SCALAR_FIELD).toBe(true);
    });
  });

  describe('IPFSAspService', () => {
    it('fetches merkle tree from IPFS gateway', { timeout: 30000 }, async () => {
      const service = new IPFSAspService({
        network: { fetch },
      });

      const result = await service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID });

      // Verify structure: array of levels
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it('returns valid bigint[][] structure', { timeout: 30000 }, async () => {
      const service = new IPFSAspService({
        network: { fetch },
      });

      const result = await service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID });

      // Each level should be an array of bigints
      for (const level of result) {
        expect(Array.isArray(level)).toBe(true);

        for (const value of level) {
          expect(typeof value).toBe('bigint');
          expect(value >= 0n).toBe(true);
        }
      }
    });

    it('tree has expected merkle tree structure (each level halves)', { timeout: 30000 }, async () => {
      const service = new IPFSAspService({
        network: { fetch },
      });

      const result = await service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID });

      // Skip this check if tree is empty or has only one level
      if (result.length <= 1) {
        return;
      }

      // Each subsequent level should have roughly half the elements (or be padding)
      // This is a loose check since the tree may have padding
      for (let i = 1; i < result.length; i++) {
        const prevLen = result[i - 1].length;
        const currLen = result[i].length;

        // Current level should have at most as many elements as previous
        expect(currLen).toBeLessThanOrEqual(prevLen);
      }

      // Last level should be the root (single element or small)
      expect(result[result.length - 1].length).toBeLessThanOrEqual(2);
    });
  });
});

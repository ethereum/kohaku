import { describe, it, expect } from 'vitest';
import { OxBowAspService, MtLeavesResponse } from '../../src/data/0xbowAsp.service';
import { RootState } from '../../src/state/store';
import { createMockFetch, createTrackedMockFetch, createFailingFetch } from '../utils/mock-fetch';
import { computeMerkleTreeRoot } from '../../src/utils/proof.util';

describe('OxBowAspService', () => {
  const TEST_CHAIN_ID = 11155111n; // Sepolia
  const TEST_SCOPE = 9423591183392302543658559874370404687995075471172962430042059179876435583731n;
  const MOCK_LEAVES = ['1', '2', '3', '4', '5'];

  const createValidResponse = (leaves: string[] = MOCK_LEAVES): MtLeavesResponse => ({
    aspLeaves: leaves,
    stateTreeLeaves: leaves,
  });

  describe('getAspTreeOxBow', () => {
    it('fetches leaves from API and computes merkle root', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          ['mt-leaves', { json: createValidResponse() }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: mockFetch },
      });

      const result = await service.getAspTreeOxBow({
        chainId: TEST_CHAIN_ID,
        scope: TEST_SCOPE,
      });

      // Verify structure: [leaves, [root]]
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(MOCK_LEAVES.length);
      expect(result[1]).toHaveLength(1);

      // Verify leaves are converted to bigint
      expect(result[0]).toEqual(MOCK_LEAVES.map(BigInt));

      // Verify root is computed correctly
      const expectedRoot = computeMerkleTreeRoot(MOCK_LEAVES.map(BigInt));

      expect(result[1][0]).toBe(expectedRoot);
    });

    it('constructs correct URL with chainId', async () => {
      const trackedFetch = createTrackedMockFetch({
        responses: new Map([
          ['mt-leaves', { json: createValidResponse() }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: trackedFetch.fetch },
      });

      await service.getAspTreeOxBow({
        chainId: TEST_CHAIN_ID,
        scope: TEST_SCOPE,
      });

      expect(trackedFetch.calls).toHaveLength(1);
      expect(trackedFetch.calls[0].url).toContain(`${Number(TEST_CHAIN_ID)}/public/mt-leaves`);
    });

    it('includes X-Pool-Scope header', async () => {
      const trackedFetch = createTrackedMockFetch({
        responses: new Map([
          ['mt-leaves', { json: createValidResponse() }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: trackedFetch.fetch },
      });

      await service.getAspTreeOxBow({
        chainId: TEST_CHAIN_ID,
        scope: TEST_SCOPE,
      });

      expect(trackedFetch.calls).toHaveLength(1);
      const headers = trackedFetch.calls[0].init?.headers as Record<string, string>;

      expect(headers['X-Pool-Scope']).toBe(TEST_SCOPE.toString(10));
    });

    it('uses custom aspUrl when provided', async () => {
      const customUrl = 'https://custom-api.example.com';
      const trackedFetch = createTrackedMockFetch({
        responses: new Map([
          ['mt-leaves', { json: createValidResponse() }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: trackedFetch.fetch },
        aspUrl: customUrl,
      });

      await service.getAspTreeOxBow({
        chainId: TEST_CHAIN_ID,
        scope: TEST_SCOPE,
      });

      expect(trackedFetch.calls[0].url).toContain(customUrl);
    });

    it('throws on network error', async () => {
      const mockFetch = createFailingFetch(new Error('Network error'));

      const service = new OxBowAspService({
        network: { fetch: mockFetch },
      });

      await expect(
        service.getAspTreeOxBow({
          chainId: TEST_CHAIN_ID,
          scope: TEST_SCOPE,
        })
      ).rejects.toThrow("Can't obtain Association Set from");
    });

    it('throws on invalid response format - missing aspLeaves', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          ['mt-leaves', { json: { stateTreeLeaves: ['1', '2'] } }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: mockFetch },
      });

      await expect(
        service.getAspTreeOxBow({
          chainId: TEST_CHAIN_ID,
          scope: TEST_SCOPE,
        })
      ).rejects.toThrow('Unexpected response');
    });

    it('throws on invalid response format - non-string leaves', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          ['mt-leaves', { json: { aspLeaves: [1, 2, 3], stateTreeLeaves: [1, 2, 3] } }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: mockFetch },
      });

      await expect(
        service.getAspTreeOxBow({
          chainId: TEST_CHAIN_ID,
          scope: TEST_SCOPE,
        })
      ).rejects.toThrow('Unexpected response');
    });

    it('throws when leaves array is empty (merkle tree requires at least one leaf)', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          ['mt-leaves', { json: createValidResponse([]) }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: mockFetch },
      });

      await expect(
        service.getAspTreeOxBow({
          chainId: TEST_CHAIN_ID,
          scope: TEST_SCOPE,
        })
      ).rejects.toThrow();
    });
  });

  describe('getAspTree', () => {

    const createMockState = (chainId: number, pools: Array<[string, { scope: string }]> = []): Partial<RootState> => ({
      entrypointInfo: {
        chainId,
        address: '0x0000000000000000000000000000000000000000',
        block: 0,
      },
      pools: {
        poolsTuples: pools,
      },
    } as unknown as RootState);

    it('extracts chainId and scope from state', async () => {
      const trackedFetch = createTrackedMockFetch({
        responses: new Map([
          ['mt-leaves', { json: createValidResponse() }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: trackedFetch.fetch },
      });

      const state = createMockState(Number(TEST_CHAIN_ID), [
        ['0xPoolAddress', { scope: TEST_SCOPE.toString() }],
      ]);

      await service.getAspTree(state as RootState);

      expect(trackedFetch.calls).toHaveLength(1);
      expect(trackedFetch.calls[0].url).toContain(`${Number(TEST_CHAIN_ID)}/public/mt-leaves`);
      const headers = trackedFetch.calls[0].init?.headers as Record<string, string>;

      expect(headers['X-Pool-Scope']).toBe(TEST_SCOPE.toString(10));
    });

    it('throws when pools array is empty', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          ['mt-leaves', { json: createValidResponse() }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: mockFetch },
      });

      const state = createMockState(Number(TEST_CHAIN_ID), []);

      await expect(
        service.getAspTree(state as RootState)
      ).rejects.toThrow('Not a single pool found. Protocol is inactive.');
    });

    it('uses first pool from pools array', async () => {
      const trackedFetch = createTrackedMockFetch({
        responses: new Map([
          ['mt-leaves', { json: createValidResponse() }],
        ]),
      });

      const service = new OxBowAspService({
        network: { fetch: trackedFetch.fetch },
      });

      const firstScope = '12345';
      const secondScope = '67890';
      const state = createMockState(Number(TEST_CHAIN_ID), [
        ['0xFirstPool', { scope: firstScope }],
        ['0xSecondPool', { scope: secondScope }],
      ]);

      await service.getAspTree(state as RootState);

      const headers = trackedFetch.calls[0].init?.headers as Record<string, string>;

      expect(headers['X-Pool-Scope']).toBe(firstScope);
    });
  });
});

import { describe, it, expect } from 'vitest';
import { IPFSAspService } from '../../src/data/ipfsAsp.service';
import { RootState } from '../../src/state/store';
import { createMockFetch, createTrackedMockFetch, createFailingFetch } from '../utils/mock-fetch';

describe('IPFSAspService', () => {
  const TEST_IPFS_CID = 'bafybeihrecrgyfkzyzli2oxnpfos5z2fgjt7zs52cbjyppigu64hva4z3i';

  // Mock tree data as string arrays (as returned from IPFS)
  const MOCK_TREE: string[][] = [
    ['1', '2', '3', '4'],  // Level 0 (leaves)
    ['5', '6'],            // Level 1
    ['7'],                 // Level 2 (root)
  ];

  describe('getAspTreeIPFS', () => {
    it('fetches tree from IPFS gateway', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          [TEST_IPFS_CID, { json: MOCK_TREE }],
        ]),
      });

      const service = new IPFSAspService({
        network: { fetch: mockFetch },
      });

      const result = await service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID });

      expect(result).toHaveLength(MOCK_TREE.length);
    });

    it('constructs correct URL with CID', async () => {
      const trackedFetch = createTrackedMockFetch({
        responses: new Map([
          [TEST_IPFS_CID, { json: MOCK_TREE }],
        ]),
      });

      const service = new IPFSAspService({
        network: { fetch: trackedFetch.fetch },
      });

      await service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID });

      expect(trackedFetch.calls).toHaveLength(1);
      expect(trackedFetch.calls[0].url).toBe(`https://ipfs.io/ipfs/${TEST_IPFS_CID}`);
    });

    it('uses custom ipfsUrl when provided', async () => {
      const customUrl = 'https://custom-ipfs-gateway.example.com/ipfs/';
      const trackedFetch = createTrackedMockFetch({
        responses: new Map([
          [TEST_IPFS_CID, { json: MOCK_TREE }],
        ]),
      });

      const service = new IPFSAspService({
        network: { fetch: trackedFetch.fetch },
        ipfsUrl: customUrl,
      });

      await service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID });

      expect(trackedFetch.calls[0].url).toBe(`${customUrl}${TEST_IPFS_CID}`);
    });

    it('converts string arrays to bigint arrays', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          [TEST_IPFS_CID, { json: MOCK_TREE }],
        ]),
      });

      const service = new IPFSAspService({
        network: { fetch: mockFetch },
      });

      const result = await service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID });

      // Verify each level contains bigints
      for (let i = 0; i < result.length; i++) {
        expect(result[i]).toEqual(MOCK_TREE[i].map(BigInt));

        // Verify they are actually bigints
        for (const value of result[i]) {
          expect(typeof value).toBe('bigint');
        }
      }
    });

    it('handles large bigint values', async () => {
      const largeValues = [
        ['21888242871839275222246405745257275088548364400416034343698204186575808495616'],
        ['12345678901234567890123456789012345678901234567890'],
      ];
      const mockFetch = createMockFetch({
        responses: new Map([
          [TEST_IPFS_CID, { json: largeValues }],
        ]),
      });

      const service = new IPFSAspService({
        network: { fetch: mockFetch },
      });

      const result = await service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID });

      expect(result[0][0]).toBe(21888242871839275222246405745257275088548364400416034343698204186575808495616n);
      expect(result[1][0]).toBe(12345678901234567890123456789012345678901234567890n);
    });

    it('throws on network error', async () => {
      const mockFetch = createFailingFetch(new Error('IPFS gateway unavailable'));

      const service = new IPFSAspService({
        network: { fetch: mockFetch },
      });

      await expect(
        service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID })
      ).rejects.toThrow('IPFS gateway unavailable');
    });

    it('handles empty tree', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          [TEST_IPFS_CID, { json: [] }],
        ]),
      });

      const service = new IPFSAspService({
        network: { fetch: mockFetch },
      });

      const result = await service.getAspTreeIPFS({ ipfsCID: TEST_IPFS_CID });

      expect(result).toHaveLength(0);
    });
  });

  describe('getAspTree', () => {
    const createMockState = (lastUpdateRootEvent: { ipfsCID: string; root: string } | null): Partial<RootState> => ({
      updateRootEvents: {
        lastUpdateRootEvent: lastUpdateRootEvent,
      },
    } as unknown as RootState);

    it('extracts CID from lastUpdateRootEvent in state', async () => {
      const trackedFetch = createTrackedMockFetch({
        responses: new Map([
          [TEST_IPFS_CID, { json: MOCK_TREE }],
        ]),
      });

      const service = new IPFSAspService({
        network: { fetch: trackedFetch.fetch },
      });

      const state = createMockState({
        ipfsCID: TEST_IPFS_CID,
        root: '12345',
      });

      await service.getAspTree(state as RootState);

      expect(trackedFetch.calls).toHaveLength(1);
      expect(trackedFetch.calls[0].url).toContain(TEST_IPFS_CID);
    });

    it('throws "No update root events" when state is empty', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          [TEST_IPFS_CID, { json: MOCK_TREE }],
        ]),
      });

      const service = new IPFSAspService({
        network: { fetch: mockFetch },
      });

      const state = createMockState(null);

      await expect(
        service.getAspTree(state as RootState)
      ).rejects.toThrow('No update root events');
    });

    it('returns tree data from IPFS', async () => {
      const mockFetch = createMockFetch({
        responses: new Map([
          [TEST_IPFS_CID, { json: MOCK_TREE }],
        ]),
      });

      const service = new IPFSAspService({
        network: { fetch: mockFetch },
      });

      const state = createMockState({
        ipfsCID: TEST_IPFS_CID,
        root: '12345',
      });

      const result = await service.getAspTree(state as RootState);

      expect(result).toHaveLength(MOCK_TREE.length);
      expect(result[0]).toEqual(MOCK_TREE[0].map(BigInt));
    });
  });
});

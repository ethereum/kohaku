import { LeanIMT } from "@zk-kit/lean-imt";
import { poseidon } from 'maci-crypto/build/ts/hashing';

import { IAspService } from '../../src/data/asp.service';

/**
 * Extended interface for mock ASP service with test helper methods
 */
export interface IMockAspService extends IAspService {
  /**
   * Add a label to the ASP tree leaves
   */
  addLabel(label: bigint): void;

  /**
   * Add multiple labels to the ASP tree leaves
   */
  addLabels(labels: bigint[]): void;

  /**
   * Set the leaves directly (replaces existing leaves)
   */
  setLeaves(leaves: bigint[]): void;

  /**
   * Get the current leaves
   */
  getLeaves(): bigint[];

  /**
   * Get the computed root from current leaves
   */
  getRoot(): bigint;

  /**
   * Reset the tree to empty state
   */
  reset(): void;

  /**
   * Set a custom IPFS CID to tree mapping
   */
  setTreeForCID(ipfsCID: string, tree: bigint[][]): void;
}

/**
 * Create a mock ASP service for testing
 */
export function createMockAspService(): IMockAspService {
  const cidToTree = new Map<string, bigint[][]>();
  let leaves: bigint[] = [];

  const service: IMockAspService = {

    // XXX: we only care about the root and leaves.
    async getAspTree(ipfsCID: string): Promise<bigint[][]> {
      // Check if there's a custom tree set for this CID
      const customTree = cidToTree.get(ipfsCID);

      if (customTree) {
        return customTree;
      }

      // Otherwise, build tree from current leaves
      const tree = new LeanIMT<bigint>((a: bigint, b: bigint) => poseidon([a, b]));

      tree.insertMany(leaves);

      return [leaves, [tree.root]];
    },

    addLabel(label: bigint): void {
      leaves.push(label);
    },

    addLabels(newLabels: bigint[]): void {
      leaves.push(...newLabels);
    },

    setLeaves(newLeaves: bigint[]): void {
      leaves = [...newLeaves];
    },

    getLeaves(): bigint[] {
      return [...leaves];
    },

    getRoot(): bigint {
      const tree = new LeanIMT<bigint>((a: bigint, b: bigint) => poseidon([a, b]));

      tree.insertMany(leaves);

      return tree.root;
    },

    reset(): void {
      leaves = [];
      cidToTree.clear();
    },

    setTreeForCID(ipfsCID: string, tree: bigint[][]): void {
      cidToTree.set(ipfsCID, tree);
    },
  };

  return service;
}

/**
 * Default mock ASP service instance for simple test cases
 */
export const mockAspService = createMockAspService();

/**
 * Factory function that returns the default mock ASP service
 */
export const mockAspServiceFactory = () => mockAspService;

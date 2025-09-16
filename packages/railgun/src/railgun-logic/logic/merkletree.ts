import {
  CommitmentCiphertextStructOutput,
  CommitmentPreimageStructOutput,
  ShieldCiphertextStructOutput,
} from '../typechain-types/contracts/logic/RailgunLogic';
import { arrayToBigInt, bigIntToArray, arrayToByteLength, hexStringToArray } from '../global/bytes';
import { SNARK_SCALAR_FIELD } from '../global/constants';
import { hash } from '../global/crypto';
import { getTokenID } from './note';
import { BigNumberish, Interface, TransactionReceipt } from 'ethers';
import { ABIRailgunSmartWallet } from '../../railgun-lib/abi/abi';

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);

enum TokenType {
  ERC20 = 0,
  ERC721 = 1,
  ERC1155 = 2,
}

interface NullifiedEventObject {
  treeNumber: number;
  nullifier: string[];
}

interface TransactEventObject {
  treeNumber: BigNumberish;
  startPosition: BigNumberish;
  hash: string[];
  ciphertext: CommitmentCiphertextStructOutput[];
}

interface ShieldEventObject {
  treeNumber: BigNumberish;
  startPosition: BigNumberish;
  commitments: CommitmentPreimageStructOutput[];
  shieldCiphertext: ShieldCiphertextStructOutput[];
  fees: BigNumberish[];
}

export interface MerkleProof {
  element: Uint8Array;
  elements: Uint8Array[];
  indices: number;
  root: Uint8Array;
}

class MerkleTree {
  treeNumber: number;

  depth: number;

  zeros: Uint8Array[];

  tree: Uint8Array[][];

  nullifiers: Uint8Array[] = [];

  /**
   * Merkle Tree
   *
   * @param treeNumber - merkle tree number
   * @param depth - merkle tree depth
   * @param zeros - zero values for each level of merkle tree
   * @param tree - starting tree
   */
  constructor(treeNumber: number, depth: number, zeros: Uint8Array[], tree: Uint8Array[][]) {
    this.treeNumber = treeNumber;
    this.depth = depth;
    this.zeros = zeros;
    this.tree = tree;
  }

  /**
   * Gets tree root
   *
   * @returns root
   */
  get root(): Uint8Array {
    return this.tree[this.depth][0];
  }

  /**
   * Gets tree length
   *
   * @returns length
   */
  get length(): number {
    return this.tree[0].length;
  }

  /**
   * Hashes 2 merkle nodes
   *
   * @param left - left value to hash
   * @param right - right value to hash
   * @returns hash
   */
  static hashLeftRight(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
    return hash.poseidon([arrayToByteLength(left, 32), arrayToByteLength(right, 32)]);
  }

  /**
   * Gets zero value for tree
   *
   * @returns zero value
   */
  static get zeroValue(): Uint8Array {
    const railgunHash = arrayToBigInt(
      hash.keccak256(new Uint8Array(Buffer.from('Railgun', 'utf8'))),
    );
    return bigIntToArray(railgunHash % SNARK_SCALAR_FIELD, 32);
  }

  /**
   * Gets zero value for each level of a tree
   *
   * @param depth - depth of tree
   * @returns zero values for each level
   */
  static async getZeroValueLevels(depth: number): Promise<Uint8Array[]> {
    // Initialize empty array for levels
    const levels: Uint8Array[] = [];

    // First level should be the leaf zero value
    levels.push(this.zeroValue);

    // Loop through remaining levels to root
    for (let level = 1; level < depth; level += 1) {
      // Push left right hash of level below's zero level
      levels.push(await MerkleTree.hashLeftRight(levels[level - 1], levels[level - 1]));
    }

    return levels;
  }

  /**
   * Create Merkle Tree
   *
   * @param treeNumber - tree number
   * @param depth - tree depth
   * @returns tree
   */
  static async createTree(treeNumber = 0, depth = 16): Promise<MerkleTree> {
    const zeros: Uint8Array[] = await MerkleTree.getZeroValueLevels(depth);
    const tree: Uint8Array[][] = Array(depth)
      .fill(0)
      .map(() => []);
    tree[depth] = [await MerkleTree.hashLeftRight(zeros[depth - 1], zeros[depth - 1])];

    return new MerkleTree(treeNumber, depth, zeros, tree);
  }

  /**
   * Rebuilds tree
   *
   * @returns complete
   */
  async rebuildSparseTree() {
    for (let level = 0; level < this.depth; level += 1) {
      this.tree[level + 1] = [];

      for (let pos = 0; pos < this.tree[level].length; pos += 2) {
        this.tree[level + 1].push(
          await MerkleTree.hashLeftRight(
            this.tree[level][pos],
            this.tree[level][pos + 1] ?? this.zeros[level],
          ),
        );
      }
    }
  }

  /**
   * Inserts leaves into tree
   *
   * @param leaves - array of leaves to add
   * @param startPosition - position to start inserting leaves from
   * @returns complete
   */
  async insertLeaves(leaves: Uint8Array[], startPosition: number) {
    if (leaves.length === 0) {
      return;
    }

    // Add leaves to tree
    leaves.forEach((leaf, index) => (this.tree[0][startPosition + index] = leaf));

    // Rebuild tree
    await this.rebuildSparseTree();
  }

  /**
   * Gets Merkle Proof for element
   *
   * @param element - element to get proof for
   * @returns proof
   */
  generateProof(element: Uint8Array): MerkleProof {
    // Initialize of proof elements
    const elements = [];

    // Get initial index
    const initialIndex = this.tree[0].map(arrayToBigInt).indexOf(arrayToBigInt(element));
    let index = initialIndex;

    if (index === -1) {
      throw new Error(`Couldn't find ${arrayToBigInt(element)} in the MerkleTree`);
    }

    // Loop through each level
    for (let level = 0; level < this.depth; level += 1) {
      if (index % 2 === 0) {
        // If index is even get element on right
        elements.push(this.tree[level][index + 1] ?? this.zeros[level]);
      } else {
        // If index is odd get element on left
        elements.push(this.tree[level][index - 1]);
      }

      // Get index for next level
      index = Math.floor(index / 2);
    }

    return {
      element,
      elements,
      indices: initialIndex,
      root: this.root,
    };
  }

  /**
   * Validates merkle proof
   *
   * @param proof - proof to validate
   * @returns isValid
   */
  static async validateProof(proof: MerkleProof): Promise<boolean> {
    // Parse indices into binary string
    const indices = proof.indices
      .toString(2)
      .padStart(proof.elements.length, '0')
      .split('')
      .reverse();

    // Initial currentHash value is the element we're proving membership for
    let currentHash = proof.element;

    // Loop though each proof level and hash together
    for (let i = 0; i < proof.elements.length; i += 1) {
      if (indices[i] === '0') {
        currentHash = await MerkleTree.hashLeftRight(currentHash, proof.elements[i]);
      } else if (indices[i] === '1') {
        currentHash = await MerkleTree.hashLeftRight(proof.elements[i], currentHash);
      }
    }

    // Return true if result is equal to merkle root
    return currentHash === proof.root;
  }

  /**
   * Scans transaction for commitments and nullifiers
   *
   * @param transaction - transaction to scan
   * @param contract - contract to parse events from
   * @returns complete
   */
  async scanTX(transaction: TransactionReceipt, contractAddress: string) {
    // KASS TODO: also scan legacy events !!!
    // Loop through each log and parse
    await Promise.all(
      transaction.logs.map(async (log) => {
        // Check if log is log of contract
        if (log.address === contractAddress) {
          // Parse log
          const parsedLog = RAILGUN_INTERFACE.parseLog(log);
          if (!parsedLog) return;

          // Check log type
          if (parsedLog.name === 'Shield') {
            // Type cast to ShieldEventObject
            const args = parsedLog.args as unknown as ShieldEventObject;

            // Get start position
            const startPosition = Number(args.startPosition.toString());

            // Get leaves
            const leaves = await Promise.all(
              args.commitments.map((commitment) =>
                hash.poseidon([
                  hexStringToArray(commitment.npk),
                  getTokenID({
                    tokenType: Number(commitment.token.tokenType.toString()) as TokenType,
                    tokenAddress: commitment.token.tokenAddress,
                    tokenSubID: BigInt(commitment.token.tokenSubID),
                  }),
                  bigIntToArray(BigInt(commitment.value), 32),
                ]),
              ),
            );

            // Insert leaves
            await this.insertLeaves(leaves, startPosition);
          } else if (parsedLog.name === 'Transact') {
            // Type cast to TransactEventObject
            const args = parsedLog.args as unknown as TransactEventObject;

            // Get start position
            const startPosition = Number(args.startPosition.toString());

            // Get leaves
            const leaves = args.hash.map((noteHash) => hexStringToArray(noteHash));

            // Insert leaves
            await this.insertLeaves(leaves, startPosition);
          } else if (parsedLog.name === 'Nullified') {
            // Type cast to NullifiedEventObject
            const args = parsedLog.args as unknown as NullifiedEventObject;

            // Get nullifiers as Uint8Array
            const nullifiersFormatted = args.nullifier.map((nullifier) =>
              hexStringToArray(nullifier),
            );

            // Push nullifiers to seen nullifiers array
            this.nullifiers.push(...nullifiersFormatted);
          }
        }
      }),
    );
  }
}

export { MerkleTree };

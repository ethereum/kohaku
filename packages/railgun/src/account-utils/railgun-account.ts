import { Wallet } from 'ethers';
import { deriveNodes, WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { encodeAddress } from '../railgun-lib/key-derivation/bech32';
import { Mnemonic } from '../railgun-lib/key-derivation/bip39';
import { ShieldNoteERC20 } from '../railgun-lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { MerkleTree } from '../railgun-logic/logic/merkletree';
import { Wallet as NoteBook } from '../railgun-logic/logic/wallet';
import { Note, SerializedNoteData } from '../railgun-logic/logic/note';
import { hexStringToArray } from '../railgun-logic/global/bytes';
import type { RailgunNetworkConfig } from '../config';
import { RAILGUN_CONFIG_BY_CHAIN_ID, ACCOUNT_VERSION, ACCOUNT_CHAIN_ID, ZERO_ADDRESS, E_ADDRESS } from '../config';
import { getWalletNodeFromKey, getERC20TokenData } from './helpers';
import { getAllLogs, processLog } from './indexer';
import * as TxBuilder from './transaction-builder';
import type { ChainId, RailgunLog, TxData } from './types';
import type { RailgunSigner } from '../provider/provider';
import { EthersSignerAdapter } from '../provider/ethers-adapter';

export class RailgunAccount {
  private network: RailgunNetworkConfig;
  private spendingNode: WalletNode;
  private viewingNode: WalletNode;
  private merkleTrees: MerkleTree[];
  private noteBooks: NoteBook[];
  private shieldKeyEthSigner?: RailgunSigner;

  /**
   * Creates a new RailgunAccount instance.
   *
   * @param chainId - The blockchain chain ID (must be supported in RAILGUN_CONFIG_BY_CHAIN_ID)
   * @param spendingNode - The spending key node for transaction authorization
   * @param viewingNode - The viewing key node for decrypting received notes
   * @param ethSigner - Optional signer for shield operations
   * @throws Error if the chain ID is not supported
   */
  constructor(chainId: ChainId, spendingNode: WalletNode, viewingNode: WalletNode, ethSigner?: RailgunSigner) {
    const networkConfig = RAILGUN_CONFIG_BY_CHAIN_ID[chainId];
    if (!networkConfig) {
      throw new Error(`Chain ID ${chainId} not supported`);
    }
    this.network = networkConfig;
    this.spendingNode = spendingNode;
    this.viewingNode = viewingNode;
    this.shieldKeyEthSigner = ethSigner;
    this.merkleTrees = [];
    this.noteBooks = [];
  }

  /**
   * Creates a RailgunAccount from a mnemonic phrase.
   * NOTE: This method creates an Ethers-based signer. For other providers (e.g., Viem),
   * use the constructor directly with the appropriate signer adapter.
   *
   * @param mnemonic - The BIP39 mnemonic phrase
   * @param accountIndex - The account index for key derivation
   * @param chainId - The blockchain chain ID
   * @returns A new RailgunAccount instance with derived keys and Ethereum signer
   * @deprecated For provider-agnostic usage, use the constructor with a RailgunSigner adapter
   */
  static fromMnemonic(mnemonic: string, accountIndex: number, chainId: ChainId): RailgunAccount {
    const {spending, viewing} = deriveNodes(mnemonic, accountIndex);
    const ethSigner = new Wallet(Mnemonic.to0xPrivateKey(mnemonic, accountIndex));
    const signerAdapter = new EthersSignerAdapter(ethSigner);
    return new RailgunAccount(chainId, spending, viewing, signerAdapter);
  }

  /**
   * Creates a RailgunAccount from explicit private keys.
   * NOTE: This method creates an Ethers-based signer. For other providers (e.g., Viem),
   * use the constructor directly with the appropriate signer adapter.
   *
   * @param spendingKey - The spending private key as hex string
   * @param viewingKey - The viewing private key as hex string
   * @param chainId - The blockchain chain ID
   * @param ethKey - Optional Ethereum private key for shield operations
   * @returns A new RailgunAccount instance with the provided keys
   * @deprecated For provider-agnostic usage, use the constructor with a RailgunSigner adapter
   */
  static fromPrivateKeys(spendingKey: string, viewingKey: string, chainId: ChainId, ethKey?: string): RailgunAccount {
    const spendingNode = getWalletNodeFromKey(spendingKey);
    const viewingNode = getWalletNodeFromKey(viewingKey);
    let ethSigner: RailgunSigner | undefined;
    if (ethKey) {
      ethSigner = new EthersSignerAdapter(new Wallet(ethKey));
    }
    return new RailgunAccount(chainId, spendingNode, viewingNode, ethSigner);
  }

  /**
   * Sets the signer for shield operations.
   *
   * @param signer - The RailgunSigner instance to use for shield operations
   */
  setShieldKeySigner(signer: RailgunSigner): void {
    this.shieldKeyEthSigner = signer;
  }

  /**
   * Sets the Ethereum signer for shield operations.
   * NOTE: This method creates an Ethers-based signer. For other providers (e.g., Viem),
   * use setShieldKeySigner with the appropriate signer adapter.
   *
   * @param ethKey - The Ethereum private key as hex string
   * @deprecated For provider-agnostic usage, use setShieldKeySigner with a RailgunSigner adapter
   */
  setShieldKeyEthSigner(ethKey: string): void {
    this.shieldKeyEthSigner = new EthersSignerAdapter(new Wallet(ethKey));
  }

  /**
   * Synchronizes the account with blockchain logs to update merkle trees and notes.
   *
   * @param logs - Array of blockchain logs to process
   * @param skipMerkleTree - If true, skips merkle tree updates (useful for initial sync)
   * @default false
   */
  async syncWithLogs(logs: RailgunLog[], skipMerkleTree: boolean = false): Promise<void> {
    const viewingKey = (await this.viewingNode.getViewingKeyPair()).privateKey;
    const spendingKey = this.spendingNode.getSpendingKeyPair().privateKey;

    for (const log of logs) {
      await processLog(log, this.merkleTrees, this.noteBooks, viewingKey, spendingKey, skipMerkleTree);
    }

    if (!skipMerkleTree) {
      for (const tree of this.merkleTrees) {
        await tree.rebuildSparseTree();
      }
    }
  }

  /**
   * Loads cached merkle trees from serialized data.
   *
   * @param merkleTrees - Array of serialized merkle tree data with tree structure and nullifiers
   */
  async loadCachedMerkleTrees(merkleTrees: {tree: string[][], nullifiers: string[]}[]): Promise<void> {
    for (let i = 0; i < merkleTrees.length; i++) {
      const merkleTree = await MerkleTree.createTree(i);
      merkleTree.tree = merkleTrees[i]!.tree.map(level => level.map(hexStringToArray));
      merkleTree.nullifiers = merkleTrees[i]!.nullifiers.map(hexStringToArray);
      if (!this.merkleTrees[i]) {
        this.merkleTrees[i] = merkleTree;
        this.noteBooks[i] = new NoteBook();
      } else {
        this.merkleTrees[i] = merkleTree;
      }
    }
  }

  /**
   * Loads cached note books from serialized note data.
   *
   * @param noteBooks - Array of serialized note data for each merkle tree
   */
  async loadCachedNoteBooks(noteBooks: SerializedNoteData[][]): Promise<void> {
    const viewingKey = (await this.viewingNode.getViewingKeyPair()).privateKey;
    const spendingKey = this.spendingNode.getSpendingKeyPair().privateKey;
    for (let i = 0; i < noteBooks.length; i++) {
      if (!this.merkleTrees[i]) {
        this.merkleTrees[i] = await MerkleTree.createTree(i);
        this.noteBooks[i] = new NoteBook();
      }
      noteBooks[i]!.forEach((noteData, j) => {
        if (noteData !== null) {
          this.noteBooks[i]!.notes[j] = Note.fromSerializedNoteData(spendingKey, viewingKey, noteData);
        }
      });
    }
  }

  /**
   * Gets the encoded Railgun address for this account.
   *
   * @returns Promise that resolves to the bech32-encoded Railgun address (starts with '0zk')
   */
  async getRailgunAddress(): Promise<string> {
    const {pubkey: viewingPubkey} = await this.viewingNode.getViewingKeyPair();
    const masterPubkey = await this.getMasterPublicKey();

    const address = encodeAddress({
      masterPublicKey: masterPubkey,
      viewingPublicKey: viewingPubkey,
      chain: ACCOUNT_CHAIN_ID,
      version: ACCOUNT_VERSION,
    });

    return address;
  }

  /**
   * Derives the master public key from spending and nullifying keys.
   *
   * @returns Promise that resolves to the master public key as a bigint
   */
  async getMasterPublicKey(): Promise<bigint> {
    const {pubkey: spendingPubkey} = this.spendingNode.getSpendingKeyPair();
    const nullifyingKey = await this.viewingNode.getNullifyingKey();
    return WalletNode.getMasterPublicKey(spendingPubkey, nullifyingKey);
  }

  /**
   * Derives the shield private key from the Ethereum signer.
   * Used for encrypting shield notes that can be decrypted by the viewing key.
   *
   * @returns Promise that resolves to the shield private key bytes
   * @throws Error if no Ethereum signer is set
   */
  async getShieldPrivateKey(): Promise<Uint8Array> {
    if (!this.shieldKeyEthSigner) {
      throw new Error('shield key eth signer not set');
    }
    const msg = ShieldNoteERC20.getShieldPrivateKeySignatureMessage();
    const signature = await this.shieldKeyEthSigner.signMessage(msg);
    const signatureBytes = ByteUtils.hexStringToBytes(signature);
    return keccak256(signatureBytes);
  }

  /**
   * Creates a transaction for shielding ERC20 tokens.
   *
   * @param token - The ERC20 token contract address
   * @param value - The amount of tokens to shield
   * @returns Promise that resolves to transaction data for shield operation
   */
  async createShieldTx(token: string, value: bigint): Promise<TxData> {
    const masterPubkey = await this.getMasterPublicKey();
    const shieldPrivateKey = await this.getShieldPrivateKey();
    const {pubkey: viewingPubkey} = await this.viewingNode.getViewingKeyPair();

    return TxBuilder.createShieldTx(
      this.network,
      masterPubkey,
      shieldPrivateKey,
      viewingPubkey,
      token,
      value
    );
  }

  /**
   * Creates a transaction for shielding native ETH (wraps to WETH first).
   *
   * @param value - The amount of ETH to shield (in wei)
   * @returns Promise that resolves to transaction data for native ETH shield
   */
  async createNativeShieldTx(value: bigint): Promise<TxData> {
    const masterPubkey = await this.getMasterPublicKey();
    const shieldPrivateKey = await this.getShieldPrivateKey();
    const {pubkey: viewingPubkey} = await this.viewingNode.getViewingKeyPair();

    return TxBuilder.createNativeShieldTx(
      this.network,
      masterPubkey,
      shieldPrivateKey,
      viewingPubkey,
      value
    );
  }

  /**
   * Creates a transaction for shielding multiple tokens in a single call.
   * Automatically handles native ETH by converting to WETH.
   *
   * @param tokens - Array of token contract addresses (use ZERO_ADDRESS or E_ADDRESS for ETH)
   * @param values - Array of token amounts corresponding to each token
   * @returns Promise that resolves to transaction data for multi-token shield
   * @throws Error if tokens and values arrays have different lengths
   */
  async createShieldTxMulti(tokens: string[], values: bigint[]): Promise<TxData> {
    const masterPubkey = await this.getMasterPublicKey();
    const shieldPrivateKey = await this.getShieldPrivateKey();
    const {pubkey: viewingPubkey} = await this.viewingNode.getViewingKeyPair();

    return TxBuilder.createShieldTxMulti(
      this.network,
      masterPubkey,
      shieldPrivateKey,
      viewingPubkey,
      tokens,
      values
    );
  }

  /**
   * Creates a transaction for unshielding tokens from Railgun to an Ethereum address.
   *
   * @param token - The ERC20 token contract address to unshield
   * @param value - The amount of tokens to unshield
   * @param receiver - The Ethereum address to receive the unshielded tokens
   * @param minGasPrice - Minimum gas price for the transaction
   * @default BigInt(0)
   * @returns Promise that resolves to transaction data for unshield operation
   */
  async createUnshieldTx(token: string, value: bigint, receiver: string, minGasPrice: bigint = BigInt(0)): Promise<TxData> {
    const {notesIn, notesOut} = await this.getTransactNotes(token, value, receiver);
    return TxBuilder.createUnshieldTx(this.network, this.merkleTrees, notesIn, notesOut, minGasPrice);
  }

  /**
   * Creates a transaction for unshielding native ETH (unwraps WETH to ETH).
   *
   * @param value - The amount of ETH to unshield (in wei)
   * @param receiver - The Ethereum address to receive the native ETH
   * @param minGasPrice - Minimum gas price for the transaction
   * @default BigInt(0)
   * @returns Promise that resolves to transaction data for native ETH unshield
   */
  async createNativeUnshieldTx(value: bigint, receiver: string, minGasPrice: bigint = BigInt(0)): Promise<TxData> {
    const {notesIn, notesOut, nullifiers} = await this.getTransactNotes(this.network.WETH, value, this.network.RELAY_ADAPT_ADDRESS, true);
    return TxBuilder.createNativeUnshieldTx(this.network, this.merkleTrees, notesIn, notesOut, nullifiers, receiver, minGasPrice);
  }

  /**
   * Creates a private transfer transaction within Railgun (from one 0zk address to another).
   *
   * @param token - The ERC20 token contract address to transfer
   * @param value - The amount of tokens to transfer
   * @param receiver - The Railgun address (0zk format) to receive the tokens
   * @param minGasPrice - Minimum gas price for the transaction
   * @default BigInt(0)
   * @returns Promise that resolves to transaction data for private transfer
   * @throws Error if receiver is not a valid Railgun 0zk address
   */
  async createPrivateTransferTx(token: string, value: bigint, receiver: string, minGasPrice: bigint = BigInt(0)): Promise<TxData> {
    if (!receiver.startsWith("0zk")) {
      throw new Error('receiver must be a railgun 0zk address');
    }
    const {notesIn, notesOut} = await this.getTransactNotes(token, value, receiver);
    return TxBuilder.createPrivateTransferTx(this.network, this.merkleTrees, notesIn, notesOut, minGasPrice);
  }

  /**
   * Prepares input and output notes for a transaction by selecting unspent notes.
   *
   * @param token - The ERC20 token contract address
   * @param value - The amount of tokens to transact
   * @param receiver - The receiver address (Ethereum 0x or Railgun 0zk format)
   * @param getNullifiers - Whether to compute nullifiers for the selected notes
   * @default false
   * @returns Promise that resolves to structured notes and nullifiers for transaction
   * @throws Error if receiver format is invalid or insufficient balance
   */
  private async getTransactNotes(token: string, value: bigint, receiver: string, getNullifiers: boolean = false) {
    const unspentNotes = await this.getUnspentNotes(token);
    const spendingKey = this.spendingNode.getSpendingKeyPair().privateKey;
    const viewingKey = (await this.viewingNode.getViewingKeyPair()).privateKey;

    return TxBuilder.prepareTransactionNotes(
      this.merkleTrees,
      this.noteBooks,
      unspentNotes,
      spendingKey,
      viewingKey,
      token,
      value,
      receiver,
      getNullifiers
    );
  }

  /**
   * Gets the total balance for a specific token across all merkle trees in this account.
   *
   * @param token - The ERC20 token contract address to get balance for.
   *                Both `ZERO_ADDRESS` and `E_ADDRESS` (0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee)
   *                are automatically converted to the network's WETH token address.
   * @default ZERO_ADDRESS - WETH
   * @returns Promise that resolves to the total token balance as a bigint
   */
  async getBalance(token: string = ZERO_ADDRESS): Promise<bigint> {
    const fixedToken = token === ZERO_ADDRESS || token === E_ADDRESS ? this.network.WETH : token;
    const tokenData = getERC20TokenData(fixedToken);
    let totalBalance = 0n;
    for (let i = 0; i < this.merkleTrees.length; i++) {
      const balance = await this.noteBooks[i]!.getBalance(this.merkleTrees[i]!, tokenData);
      totalBalance += balance;
    }

    return totalBalance;
  }

  /**
   * Gets all unspent notes for a specific token across all merkle trees.
   *
   * @param token - The ERC20 token contract address
   * @returns Promise that resolves to array of unspent note arrays (one per tree)
   */
  async getUnspentNotes(token: string): Promise<Note[][]> {
    const tokenData = getERC20TokenData(token);
    const allNotes: Note[][] = [];
    for (let i = 0; i < this.merkleTrees.length; i++) {
      const notes = await this.noteBooks[i]!.getUnspentNotes(this.merkleTrees[i]!, tokenData);
      allNotes.push(notes);
    }

    return allNotes;
  }

  /**
   * Submits a transaction to the blockchain using the provided signer.
   * NOTE: This is a crude/simple TX submission function, intended only as a helper for testing.
   *
   * @param input - The transaction data to submit
   * @param signer - The signer to use for transaction submission
   * @returns Promise that resolves to the transaction hash
   */
  async submitTx(input: TxData, signer: RailgunSigner): Promise<string> {
    return await signer.sendTransaction({
      to: input.to,
      data: input.data,
      value: input.value,
      gasLimit: 6000000,
    });
  }

  /**
   * Gets all notes (spent and unspent) for a specific merkle tree.
   *
   * @param treeIndex - The index of the merkle tree
   * @returns Array of all notes in the specified tree
   * @throws Error if tree index does not exist
   */
  getAllNotes(treeIndex: number): Note[] {
    if (!this.noteBooks[treeIndex]) {
      throw new Error('tree index DNE');
    }
    return this.noteBooks[treeIndex].notes;
  }

  /**
   * Gets the merkle root for a specific tree.
   *
   * @param treeIndex - The index of the merkle tree
   * @returns The merkle root as Uint8Array
   * @throws Error if tree index does not exist
   */
  getMerkleRoot(treeIndex: number): Uint8Array {
    if (!this.merkleTrees[treeIndex]) {
      throw new Error('tree index DNE');
    }
    return this.merkleTrees[treeIndex].root;
  }

  /**
   * Gets the merkle root of the latest (most recent) tree.
   *
   * @returns The merkle root of the last tree as Uint8Array
   */
  getLatestMerkleRoot(): Uint8Array {
    return this.merkleTrees[this.merkleTrees.length - 1]!.root;
  }

  /**
   * Serializes all merkle trees to a storable format.
   *
   * @returns Array of serialized merkle tree data with hex-encoded tree structure and nullifiers
   */
  serializeMerkleTrees(): {tree: string[][], nullifiers: string[]}[] {
    const merkleTrees = [];
    for (const tree of this.merkleTrees) {
      merkleTrees.push({
        tree: tree.tree.map(level => level.map(leaf => ByteUtils.hexlify(leaf, true))),
        nullifiers: tree.nullifiers.map(nullifier => ByteUtils.hexlify(nullifier, true)),
      });
    }
    return merkleTrees;
  }

  /**
   * Serializes all note books to a storable format.
   *
   * @returns Array of serialized note book data
   */
  serializeNoteBooks(): SerializedNoteData[][] {
    const noteBooks = [];
    for (const noteBook of this.noteBooks) {
      noteBooks.push(noteBook.serialize());
    }
    return noteBooks;
  }
}

// Re-export getAllLogs for backward compatibility
export { getAllLogs };

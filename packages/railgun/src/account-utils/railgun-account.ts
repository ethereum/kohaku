import { deriveNodes, WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { encodeAddress, decodeAddress } from '../railgun-lib/key-derivation/bech32';
import { Mnemonic } from '../railgun-lib/key-derivation/bip39';
import { Wallet, JsonRpcProvider, Log, Interface, AbiCoder, BigNumberish } from 'ethers';
import { ShieldNoteERC20 } from '../railgun-lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { ShieldRequestStruct } from '../railgun-lib/abi/typechain/RailgunSmartWallet';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { ABIRailgunSmartWallet, ABIRelayAdapt } from '../railgun-lib/abi/abi';
import { MerkleTree } from '../railgun-logic/logic/merkletree';
import { Wallet as NoteBook } from '../railgun-logic/logic/wallet';
import { Note, TokenData, UnshieldNote, SerializedNoteData, SendNote } from '../railgun-logic/logic/note';
import { transact, PublicInputs } from '../railgun-logic/logic/transaction';
import {
  CommitmentCiphertextStructOutput,
  ShieldCiphertextStructOutput,
  CommitmentPreimageStructOutput
} from '../railgun-logic/typechain-types/contracts/logic/RailgunLogic';
import { bigIntToArray, hexStringToArray } from '../railgun-logic/global/bytes';
import { getTokenID } from '../railgun-logic/logic/note';
import { hash } from '../railgun-logic/global/crypto';

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);
const RELAY_ADAPT_INTERFACE = new Interface(ABIRelayAdapt);

const ACCOUNT_VERSION = 1;
const ACCOUNT_CHAIN_ID = undefined;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ZERO_ARRAY = new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
const E_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TOTAL_LEAVES = 2**16;

export const RAILGUN_CONFIG_BY_CHAIN_ID = {
  ["1"]: {
    NAME: 'mainnet',
    RAILGUN_ADDRESS: '0xFA7093CDD9EE6932B4eb2c9e1cde7CE00B1FA4b9',
    GLOBAL_START_BLOCK: 14693013,
    CHAIN_ID: BigInt(1),
    RELAY_ADAPT_ADDRESS: '0x4025ee6512DBbda97049Bcf5AA5D38C54aF6bE8a',
    WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    FEE_BASIS_POINTS: 25n,
  },
  ["11155111"]: {
    NAME: 'sepolia',
    RAILGUN_ADDRESS: '0x942D5026b421cf2705363A525897576cFAdA5964',
    GLOBAL_START_BLOCK: 4495479,
    CHAIN_ID: BigInt(11155111),
    RELAY_ADAPT_ADDRESS: '0x66af65bfff9e384796a56f3fa3709b9d5d9d7083',
    WETH: '0x97a36608DA67AF0A79e50cb6343f86F340B3b49e',
    FEE_BASIS_POINTS: 25n,
  }
}

export type RailgunNetworkConfig = {
  NAME: string;
  RAILGUN_ADDRESS: string;
  GLOBAL_START_BLOCK: number;
  CHAIN_ID: bigint;
  RELAY_ADAPT_ADDRESS: string;
  WETH: string;
  FEE_BASIS_POINTS: bigint;
}

enum TokenType {
  ERC20 = 0,
  ERC721 = 1,
  ERC1155 = 2,
}

export type TxData = {
  to: string;
  data: string;
  value: bigint;
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

interface NullifiedEventObject {
  treeNumber: number;
  nullifier: string[];
}

const getWalletNodeFromKey = (priv: string) => {
  const wallet = new Wallet(priv);
  return new WalletNode({chainKey: wallet.privateKey, chainCode: ''});
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRangeErr(e: any) {
  return (
    e?.error?.code === -32001 ||
    /failed to resolve block range/i.test(String(e?.error?.message || e?.message || ""))
  );
}

export const getAllLogs = async (provider: JsonRpcProvider, chainId: bigint, startBlock: number, endBlock: number) => {
  const MAX_BATCH = 1200;
  const MIN_BATCH = 1;
  const railgunAddress = RAILGUN_CONFIG_BY_CHAIN_ID[chainId.toString() as keyof typeof RAILGUN_CONFIG_BY_CHAIN_ID].RAILGUN_ADDRESS;
  let batch = Math.min(MAX_BATCH, Math.max(1, endBlock - startBlock + 1));
  let from = startBlock;
  const allLogs: Log[] = [];

  while (from <= endBlock) {
    const to = Math.min(from + batch - 1, endBlock);
    try {
      await new Promise(r => setTimeout(r, 400)); // light pacing
      const logs = await provider.getLogs({
        address: railgunAddress,
        fromBlock: from,
        toBlock: to,
      });
      allLogs.push(...logs);
      from = to + 1;                 // advance
      batch = Math.min(batch * 2, MAX_BATCH); // grow again after success
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      if (isRangeErr(e)) {
        if (batch > MIN_BATCH) {
          batch = Math.max(MIN_BATCH, Math.floor(batch / 2)); // shrink and retry same 'from'
          continue;
        }
        // single-block still fails: skip this block to move on
        from = to + 1;
        continue;
      }
      throw e; // non-range error -> surface it
    }
  }

  return allLogs;
};

export const getERC20TokenData = (token: string): TokenData => {
  const tokenData = {
    tokenType: 0,
    tokenAddress: token,
    tokenSubID: 0n,
  };
  return tokenData;
}

const getTxData = (address: string, payload: string, value: bigint = BigInt(0)): TxData => {
  return {
    to: address,
    data: payload,
    value: value,
  };
}

type Call = {
  to: string;
  data: string;
  value: bigint | number | string;
};

type ActionData = {
  random: string;
  requireSuccess: boolean;
  minGasLimit: bigint | number | string;
  calls: Call[];
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toActionDataTuple(a: ActionData): any[] {
  const callsTuple = a.calls.map((c) => [
    c.to,
    c.data ?? '0x',
    c.value ?? 0n,
  ]);
  return [a.random, a.requireSuccess, a.minGasLimit, callsTuple];
}

export function getAdaptParamsHash(
  nullifiers: string[][],
  actionData: ActionData
): Uint8Array {
  const coder = new AbiCoder();
  const encoded = coder.encode(
    ['bytes32[][]', 'uint256', 'tuple(bytes31,bool,uint256,tuple(address,bytes,uint256)[])'],
    [nullifiers, BigInt(nullifiers.length), toActionDataTuple(actionData)]
  );

  return keccak256(ByteUtils.hexToBytes(encoded));
}

export class RailgunAccount {

  private network: RailgunNetworkConfig;
  private spendingNode: WalletNode;
  private viewingNode: WalletNode;
  private merkleTrees: MerkleTree[];
  private noteBooks: NoteBook[];
  private shieldKeyEthSigner?: Wallet;

  constructor(chainId: bigint, spendingNode: WalletNode, viewingNode: WalletNode, ethSigner?: Wallet) {
    if (!Object.keys(RAILGUN_CONFIG_BY_CHAIN_ID).includes(chainId.toString())) {
      throw new Error(`Chain ID ${chainId} not supported`);
    }
    this.network = RAILGUN_CONFIG_BY_CHAIN_ID[chainId.toString() as keyof typeof RAILGUN_CONFIG_BY_CHAIN_ID];
    this.spendingNode = spendingNode;
    this.viewingNode = viewingNode;
    this.shieldKeyEthSigner = ethSigner;
    this.merkleTrees = [];
    this.noteBooks = [];
  }

  static fromMnemonic(mnemonic: string, accountIndex: number, chainId: bigint): RailgunAccount {
    const {spending, viewing} = deriveNodes(mnemonic, accountIndex);
    const ethSigner = new Wallet(Mnemonic.to0xPrivateKey(mnemonic, accountIndex));
    return new RailgunAccount(chainId, spending, viewing, ethSigner);
  }

  static fromPrivateKeys(spendingKey: string, viewingKey: string, chainId: bigint, ethKey?: string): RailgunAccount {
    const spendingNode = getWalletNodeFromKey(spendingKey);
    const viewingNode = getWalletNodeFromKey(viewingKey);
    const ethSigner = ethKey ? new Wallet(ethKey) : undefined;
    return new RailgunAccount(chainId, spendingNode, viewingNode, ethSigner);
  }

  setShieldKeyEthSigner(ethKey: string) {
    this.shieldKeyEthSigner = new Wallet(ethKey);
  }

  async syncWithLogs(logs: Log[], skipMerkleTree: boolean = false) {
    for (const log of logs) {
      await this.processLog(log, skipMerkleTree);
    }
    if (!skipMerkleTree) {
      for (const tree of this.merkleTrees) {
        await tree.rebuildSparseTree();
      }
    }
  }

  async loadCachedMerkleTrees(merkleTrees: {tree: string[][], nullifiers: string[]}[]) {
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

  async loadCachedNoteBooks(noteBooks: SerializedNoteData[][]) {
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

  async getMasterPublicKey(): Promise<bigint> {
    const {pubkey: spendingPubkey} = this.spendingNode.getSpendingKeyPair();
    const nullifyingKey = await this.viewingNode.getNullifyingKey();
    return WalletNode.getMasterPublicKey(spendingPubkey, nullifyingKey);
  }

  async getShieldPrivateKey(): Promise<Uint8Array> {
    if (!this.shieldKeyEthSigner) {
      throw new Error('shield key eth signer not set');
    }
    const msg = ShieldNoteERC20.getShieldPrivateKeySignatureMessage();
    const signature = await this.shieldKeyEthSigner.signMessage(msg);
    const signatureBytes = ByteUtils.hexStringToBytes(signature);
    return keccak256(signatureBytes);
  }

  async buildShieldNote(token: string, value: bigint): Promise<ShieldNoteERC20> {
    const masterPubkey = await this.getMasterPublicKey();
    return new ShieldNoteERC20(masterPubkey, ByteUtils.randomHex(16), value, token);
  }

  async encodeShieldNote(shieldNote: ShieldNoteERC20): Promise<ShieldRequestStruct> {
    const shieldPrivateKey = await this.getShieldPrivateKey();
    const {pubkey: viewingPubkey} = await this.viewingNode.getViewingKeyPair();
    return shieldNote.serialize(shieldPrivateKey, viewingPubkey);
  }

  async createShieldRequest(token: string, value: bigint): Promise<ShieldRequestStruct> {
    const shieldNote = await this.buildShieldNote(token, value);
    const request = await this.encodeShieldNote(shieldNote);
    return request;
  }

  async createShieldTx(token: string, value: bigint): Promise<TxData> {
    const request = await this.createShieldRequest(token, value);
    const data = RAILGUN_INTERFACE.encodeFunctionData('shield', [[request]]);

    return getTxData(this.network.RAILGUN_ADDRESS, data);
  }

  async createNativeShieldTx(value: bigint): Promise<TxData> {
    const request = await this.createShieldRequest(this.network.WETH, value);
    const wrapTxData = getTxData(this.network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('wrapBase', [value]));
    const shieldTxData = getTxData(this.network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('shield', [[request]]));
    const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('multicall', [true, [wrapTxData, shieldTxData]]);
    
    return getTxData(this.network.RELAY_ADAPT_ADDRESS, data, value);
  }

  async createShieldTxMulti(tokens: string[], values: bigint[]): Promise<TxData> {
    if (tokens.length !== values.length) {
      throw new Error('tokens and values must have the same length');
    }
    let nativeValue = 0n;
    const requests: ShieldRequestStruct[] = [];
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === ZERO_ADDRESS || tokens[i] === E_ADDRESS) {
        nativeValue += values[i]!;
        requests.push(await this.createShieldRequest(this.network.WETH, values[i]!));
      } else {
        requests.push(await this.createShieldRequest(tokens[i]!, values[i]!));
      }
    }
    if (nativeValue == 0n) {
      const data = RAILGUN_INTERFACE.encodeFunctionData('shield', [requests]);
      return getTxData(this.network.RAILGUN_ADDRESS, data);
    }
    
    const wrapTxData = getTxData(this.network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('wrapBase', [nativeValue]));
    const shieldTxData = getTxData(this.network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('shield', [requests]));
    const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('multicall', [true, [wrapTxData, shieldTxData]]);
    
    return getTxData(this.network.RELAY_ADAPT_ADDRESS, data, nativeValue);
  }

  async createUnshieldTx(token: string, value: bigint, receiver: string, minGasPrice: bigint = BigInt(0)): Promise<TxData> {
    const {notesIn, notesOut} = await this.getTransactNotes(token, value, receiver);
    const allInputs: PublicInputs[] = [];
    for (let i = 0; i < notesIn.length; i++) {
      if (notesIn[i]!.length === 0) { continue; }
      const inputs = await transact(
        this.merkleTrees[i]!,
        minGasPrice,
        1, // unshield type
        this.network.CHAIN_ID,
        ZERO_ADDRESS, // adapt contract
        ZERO_ARRAY, // adapt params
        notesIn[i]!,
        notesOut[i]!,
      );
      allInputs.push(inputs);
    }
    const data = RAILGUN_INTERFACE.encodeFunctionData('transact', [allInputs]);
    
    return getTxData(this.network.RAILGUN_ADDRESS, data);
  }

  async createNativeUnshieldTx(value: bigint, receiver: string, minGasPrice: bigint = BigInt(0)) {
    const {notesIn, notesOut, nullifiers} = await this.getTransactNotes(this.network.WETH, value, this.network.RELAY_ADAPT_ADDRESS, true);

    const unwrapTxData = getTxData(this.network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('unwrapBase', [0]));
    const ethTransfer = [{token: {tokenType: 0, tokenAddress: ZERO_ADDRESS, tokenSubID: 0n}, to: receiver, value: 0n}];
    const transferTxData = getTxData(this.network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('transfer', [ethTransfer]));
    const actionData = {
      random: "0x"+ ByteUtils.randomHex(31),
      requireSuccess: true,
      minGasLimit: minGasPrice,
      calls: [unwrapTxData, transferTxData],
    }
    const nonEmptyNullifiers = nullifiers.filter(arr => arr.length > 0);
    const nullifiers2D: string[][] = nonEmptyNullifiers.map(
      arr => arr.map(n => ByteUtils.hexlify(n, true))
    );
    const relayAdaptParams = getAdaptParamsHash(nullifiers2D, actionData);
    const allInputs: PublicInputs[] = [];
    for (let i = 0; i < notesIn.length; i++) {
      if (notesIn[i]!.length === 0) { continue; }
      const inputs = await transact(
        this.merkleTrees[i]!,
        minGasPrice,
        1, // unshield type
        this.network.CHAIN_ID,
        this.network.RELAY_ADAPT_ADDRESS,
        relayAdaptParams,
        notesIn[i]!,
        notesOut[i]!,
      );
      allInputs.push(inputs);
    }
    const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('relay', [allInputs, actionData]);
    
    return getTxData(this.network.RELAY_ADAPT_ADDRESS, data);
  }

  async createInternalTransactTx(token: string, value: bigint, receiver: string, minGasPrice: bigint = BigInt(0)) {
    if (!receiver.startsWith("0zk")) {
      throw new Error('receiver must be a railgun 0zk address');
    }
    const {notesIn, notesOut} = await this.getTransactNotes(token, value, receiver);
    const allInputs: PublicInputs[] = [];
    for (let i = 0; i < notesIn.length; i++) {
      if (notesIn[i]!.length === 0) { continue; }
      const inputs = await transact(
        this.merkleTrees[i]!,
        minGasPrice,
        0, // no unshield
        this.network.CHAIN_ID,
        ZERO_ADDRESS, // adapt contract
        ZERO_ARRAY, // adapt params
        notesIn[i]!,
        notesOut[i]!,
      );
      allInputs.push(inputs);
    }
    const data = RAILGUN_INTERFACE.encodeFunctionData('transact', [allInputs]);
    
    return getTxData(this.network.RAILGUN_ADDRESS, data);
  }

  async getTransactNotes(token: string, value: bigint, receiver: string, getNullifiers: boolean = false): Promise<{notesIn: Note[][], notesOut: (Note | UnshieldNote | SendNote)[][], nullifiers: Uint8Array[][]}> {
    const unspentNotes = await this.getUnspentNotes(token);
    const isUnshield = receiver.startsWith("0x");
    if (!isUnshield && ! receiver.startsWith("0zk")) {
      throw new Error('receiver must be an ethereum 0x address or a railgun 0zk address');
    }

    const notesIn: Note[][] = [];
    const notesOut: (Note | UnshieldNote | SendNote)[][] = [];
    const nullifiers: Uint8Array[][] = [];
    let totalValue = 0n;
    let valueSpent = 0n;
    for (let i = 0; i < unspentNotes.length; i++) {
      const allNotes = this.noteBooks[i]!.notes;
      const treeNotesIn: Note[] = [];
      const treeNullifiers: Uint8Array[] = [];
      let treeValue = 0n;
      for (const note of unspentNotes[i]!) {
        totalValue += note.value;
        treeValue += note.value;
        treeNotesIn.push(note);
        if (getNullifiers) { treeNullifiers.push(await note.getNullifier(allNotes.indexOf(note))); }
        if (totalValue >= value) {
          break;
        }
      }
  
      const tokenData = getERC20TokenData(token);
  
      const treeNotesOut: (Note | UnshieldNote | SendNote)[] = [];
      const spendingKey = this.spendingNode.getSpendingKeyPair().privateKey;
      const viewingKey = (await this.viewingNode.getViewingKeyPair()).privateKey;
      if (totalValue > value) { 
        const changeNote = new Note(spendingKey, viewingKey, totalValue - value, ByteUtils.hexStringToBytes(ByteUtils.randomHex(16)), tokenData, '');
        treeNotesOut.push(changeNote);
      }
  
      if (treeValue > 0n) {
        const amount = treeValue > value - valueSpent ? value - valueSpent : treeValue;
        if (isUnshield) {
          treeNotesOut.push(new UnshieldNote(receiver, amount, tokenData));
        } else {
          const {masterPublicKey, viewingPublicKey} = decodeAddress(receiver);
          treeNotesOut.push(new SendNote(masterPublicKey, viewingPublicKey, amount, ByteUtils.hexStringToBytes(ByteUtils.randomHex(16)), tokenData, ''));
        }
        valueSpent += amount;
      }

      notesIn.push(treeNotesIn);
      notesOut.push(treeNotesOut);
      nullifiers.push(treeNullifiers);
      if (totalValue >= value) {
        break;
      }
    }

    if (totalValue < value) {
      throw new Error('insufficient value in unspent notes');
    }

    return {notesIn, notesOut, nullifiers};
  }

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

  async getUnspentNotes(token: string): Promise<Note[][]> {
    const tokenData = getERC20TokenData(token);
    const allNotes: Note[][] = [];
    for (let i = 0; i < this.merkleTrees.length; i++) {
      const notes = await this.noteBooks[i]!.getUnspentNotes(this.merkleTrees[i]!, tokenData);
      allNotes.push(notes);
    }

    return allNotes;
  }

  // NOTE: crude/simple TX submission func, intended only as a helper for testing
  async submitTx(input: TxData, signer: Wallet): Promise<string> {
    const tx = await signer.sendTransaction({
      to: input.to,
      data: input.data,
      value: input.value,
      gasLimit: 6000000,
    });
    return tx.hash;
  }

  getAllNotes(treeIndex: number): Note[] {
    if (!this.noteBooks[treeIndex]) {
      throw new Error('tree index DNE');
    }
    return this.noteBooks[treeIndex].notes;
  }

  getMerkleRoot(treeIndex: number) {
    if (!this.merkleTrees[treeIndex]) {
      throw new Error('tree index DNE');
    }
    return this.merkleTrees[treeIndex].root;
  }

  getLatestMerkleRoot() {
    return this.merkleTrees[this.merkleTrees.length - 1]!.root;
  }

  serializeMerkleTrees() {
    const merkleTrees = [];
    for (const tree of this.merkleTrees) {

      merkleTrees.push({
        tree: tree.tree.map(level => level.map(leaf => ByteUtils.hexlify(leaf, true))),
        nullifiers: tree.nullifiers.map(nullifier => ByteUtils.hexlify(nullifier, true)),
      });
    }
    return merkleTrees;
  }

  serializeNoteBooks() {
    const noteBooks = [];
    for (const noteBook of this.noteBooks) {
      noteBooks.push(noteBook.serialize());
    }
    return noteBooks;
  }

  async processLog(log: Log, skipMerkleTree: boolean = false) {
    // KASS TODO: also scan legacy events !!!
    // Parse log
    const parsedLog = RAILGUN_INTERFACE.parseLog(log);
    if (!parsedLog) return;

    // Check log type
    if (parsedLog.name === 'Shield') {
      // Type cast to ShieldEventObject
      const args = parsedLog.args as unknown as ShieldEventObject;

      // Get start position
      const startPosition = Number(args.startPosition.toString());

      // Get tree number
      const treeNumber = Number(args.treeNumber.toString());
      
      if (!skipMerkleTree) {
        // Check tree boundary
        const isCrossingTreeBoundary = startPosition +args.commitments.length > TOTAL_LEAVES;
        
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
        if (isCrossingTreeBoundary) {
          if (!this.merkleTrees[treeNumber+1]) {
            this.merkleTrees[treeNumber+1] = await MerkleTree.createTree(treeNumber+1);
            this.noteBooks[treeNumber+1] = new NoteBook();
          }
          this.merkleTrees[treeNumber+1]!.insertLeaves(leaves, 0);
        } else {
          if (!this.merkleTrees[treeNumber]) {
            this.merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
            this.noteBooks[treeNumber] = new NoteBook();
          }
          this.merkleTrees[treeNumber]!.insertLeaves(leaves, startPosition);
        }
      }

      const viewingKey = (await this.viewingNode.getViewingKeyPair()).privateKey;
      const spendingKey = this.spendingNode.getSpendingKeyPair().privateKey;

      args.shieldCiphertext.map((shieldCiphertext, index) => {
        // Try to decrypt
        const decrypted = Note.decryptShield(
          hexStringToArray(shieldCiphertext.shieldKey),
          shieldCiphertext.encryptedBundle.map(hexStringToArray) as [
            Uint8Array,
            Uint8Array,
            Uint8Array,
          ],
          {
            tokenType: Number(args.commitments[index]!.token.tokenType.toString()) as TokenType,
            tokenAddress: args.commitments[index]!.token.tokenAddress,
            tokenSubID: BigInt(args.commitments[index]!.token.tokenSubID),
          },
          BigInt(args.commitments[index]!.value),
          viewingKey,
          spendingKey,
        );

        // Insert into note array in same index as merkle tree
        if (decrypted) {
          if (startPosition+index >= TOTAL_LEAVES) {
            this.noteBooks[treeNumber+1]!.notes[startPosition+index-TOTAL_LEAVES] = decrypted;
          } else {
            this.noteBooks[treeNumber]!.notes[startPosition+index] = decrypted;
          }
        }
      });
    } else if (parsedLog.name === 'Transact') {
      // Type cast to TransactEventObject
      const args = parsedLog.args as unknown as TransactEventObject;

      // Get start position
      const startPosition = Number(args.startPosition.toString());

      // Get tree number
      const treeNumber = Number(args.treeNumber.toString());

      if (!skipMerkleTree) {
        // Check tree boundary
        const isCrossingTreeBoundary = startPosition + args.hash.length > TOTAL_LEAVES;

        // Get leaves
        const leaves = args.hash.map((noteHash) => hexStringToArray(noteHash));

        // Insert leaves
        if (isCrossingTreeBoundary) {
          if (!this.merkleTrees[treeNumber+1]) {
            this.merkleTrees[treeNumber+1] = await MerkleTree.createTree(treeNumber+1);
            this.noteBooks[treeNumber+1] = new NoteBook();
          }
          this.merkleTrees[treeNumber+1]!.insertLeaves(leaves, 0);
        } else {
          if (!this.merkleTrees[treeNumber]) {
            this.merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
            this.noteBooks[treeNumber] = new NoteBook();
          }
          this.merkleTrees[treeNumber]!.insertLeaves(leaves, startPosition);
        }
      }

      const viewingKey = (await this.viewingNode.getViewingKeyPair()).privateKey;
      const spendingKey = this.spendingNode.getSpendingKeyPair().privateKey;
      
      // Loop through each token we're scanning
      await Promise.all(
        // Loop through every note and try to decrypt as token
        args.ciphertext.map(async (ciphertext, index) => {
          // Attempt to decrypt note with token
          const note = await Note.decrypt(
            {
              ciphertext: [
                hexStringToArray(ciphertext.ciphertext[0]),
                hexStringToArray(ciphertext.ciphertext[1]),
                hexStringToArray(ciphertext.ciphertext[2]),
                hexStringToArray(ciphertext.ciphertext[3]),
              ],
              blindedSenderViewingKey: hexStringToArray(
                ciphertext.blindedSenderViewingKey,
              ),
              blindedReceiverViewingKey: hexStringToArray(
                ciphertext.blindedReceiverViewingKey,
              ),
              annotationData: hexStringToArray(ciphertext.annotationData),
              memo: hexStringToArray(ciphertext.memo),
            },
            viewingKey,
            spendingKey,
          );

          // If note was decrypted add to wallet
          if (note) {
            if (startPosition+index >= TOTAL_LEAVES) {
              this.noteBooks[treeNumber+1]!.notes[startPosition + index - TOTAL_LEAVES] = note;
            } else {
              this.noteBooks[treeNumber]!.notes[startPosition + index] = note;
            }
          }
        }),
      );
    } else if (parsedLog.name === 'Nullified' && !skipMerkleTree) {
      // Type cast to NullifiedEventObject
      const args = parsedLog.args as unknown as NullifiedEventObject;

      // Get tree number
      const treeNumber = Number(args.treeNumber.toString());

      // Create new merkleTrees and noteBooks if necessary
      if (!this.merkleTrees[treeNumber]) {
        this.merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
        this.noteBooks[treeNumber] = new NoteBook();
      }
      
      const nullifiersFormatted = args.nullifier.map((nullifier) =>
        hexStringToArray(nullifier),
      );
      this.merkleTrees[treeNumber]!.nullifiers.push(...nullifiersFormatted);
    }
  }
}

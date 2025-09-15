import { deriveNodes, WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { encodeAddress } from '../railgun-lib/key-derivation/bech32';
import { Mnemonic } from '../railgun-lib/key-derivation/bip39';
import { Wallet, Contract, JsonRpcProvider, TransactionReceipt, Interface } from 'ethers';
import { ShieldNoteERC20 } from '../railgun-lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { ShieldRequestStruct } from '../railgun-lib/abi/typechain/RailgunSmartWallet';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { ABIRailgunSmartWallet, ABIRelayAdapt } from '../railgun-lib/abi/abi';
import { MerkleTree } from '../railgun-logic/logic/merkletree';
import { Wallet as NoteBook } from '../railgun-logic/logic/wallet';
import { Note, TokenData, UnshieldNote } from '../railgun-logic/logic/note';
import { transact, PublicInputs } from '../railgun-logic/logic/transaction';

const ACCOUNT_VERSION = 1;
const ACCOUNT_CHAIN_ID = undefined;
export const RAILGUN_ADDRESS = '0x942D5026b421cf2705363A525897576cFAdA5964';
export const GLOBAL_START_BLOCK = 4495479;
export const CHAIN_ID = BigInt(11155111);
export const RELAY_ADAPT_ADDRESS = '0x66af65bfff9e384796a56f3fa3709b9d5d9d7083';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const WETH = '0x97a36608DA67AF0A79e50cb6343f86F340B3b49e';
export const FEE_BASIS_POINTS = 25n;

export interface Cache {
  receipts: TransactionReceipt[];
  endBlock: number;
}

export type TxData = {
  to: string;
  data: string;
  value: bigint;
}

const getWalletNodeFromKey = (priv: string) => {
  const wallet = new Wallet(priv);
  return new WalletNode({chainKey: wallet.privateKey, chainCode: ''});
};

const getAllReceipts = async (provider: JsonRpcProvider, startBlock: number, endBlock: number) => {
  const BATCH_SIZE = 2500; // NOTE: works with infura key
  let allLogs: any[] = [];
  for (let from = startBlock; from <= endBlock; from += BATCH_SIZE) {
    // console.log(`Getting logs from block ${from} to ${Math.min(from + BATCH_SIZE - 1, endBlock)}`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // TODO: crude rate limiting
    const to = Math.min(from + BATCH_SIZE - 1, endBlock);
    const logs = await provider.getLogs({
      address: RAILGUN_ADDRESS,
      fromBlock: from,
      toBlock: to,
    });
    allLogs = allLogs.concat(logs);
  }
  const TXIDs = Array.from(new Set(allLogs.map(log => log.transactionHash)));
  const receipts: TransactionReceipt[] = [];
  for (const txID of TXIDs) {
    const receipt = await provider.getTransactionReceipt(txID);
    await new Promise(resolve => setTimeout(resolve, 1000));
    if (receipt) {
      receipts.push(receipt);
    }
  }

  return receipts;
}

export const getERC20TokenData = (token: string): TokenData => {
  const tokenData = {
    tokenType: 0,
    tokenAddress: token,
    tokenSubID: 0n,
  };
  return tokenData;
}

const payloadToAdaptCall = (payload: string, value: bigint = BigInt(0)): TxData => {
  return {
    to: RELAY_ADAPT_ADDRESS,
    data: payload,
    value: value,
  };
}

const getDummyTransactTx = (nullifiers: Uint8Array[]) => {
  const nullG1Point = { x: 0, y: 0 };
  const nullG2Point = { x: [0, 0], y: [0, 0] };

  const nullSnarkProof = {
    a: { ...nullG1Point },
    b: { ...nullG2Point },
    c: { ...nullG1Point },
  };

  const nullTokenData = {
    tokenType: 0,
    tokenAddress: "0x0000000000000000000000000000000000000000",
    tokenSubID: 0,
  };

  const nullBoundParams = {
    treeNumber: 0,
    minGasPrice: 0,
    unshield: 0,
    chainID: 0,
    adaptContract: "0x0000000000000000000000000000000000000000",
    adaptParams: "0x0000000000000000000000000000000000000000000000000000000000000000",
    commitmentCiphertext: [],
  };

  const nullCommitmentPreimage = {
    npk: "0x0000000000000000000000000000000000000000000000000000000000000000",
    token: { ...nullTokenData },
    value: 0,
  };

 return {
    proof: { ...nullSnarkProof },
    merkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
    nullifiers: nullifiers,
    commitments: [],
    boundParams: { ...nullBoundParams },
    unshieldPreimage: { ...nullCommitmentPreimage },
  };
}

export default class RailgunAccount {

  private spendingNode: WalletNode;
  private viewingNode: WalletNode;
  private shieldKeyEthSigner?: Wallet;
  private merkleTree?: MerkleTree;
  private noteBook?: NoteBook;

  constructor(spendingNode: WalletNode, viewingNode: WalletNode, ethSigner?: Wallet) {
    this.spendingNode = spendingNode;
    this.viewingNode = viewingNode;
    this.shieldKeyEthSigner = ethSigner;
  }

  static fromMnemonic(mnemonic: string, accountIndex: number): RailgunAccount {
    const {spending, viewing} = deriveNodes(mnemonic, accountIndex);
    const ethSigner = new Wallet(Mnemonic.to0xPrivateKey(mnemonic, accountIndex));
    return new RailgunAccount(spending, viewing, ethSigner);
  }

  static fromPrivateKeys(spendingKey: string, viewingKey: string, ethKey?: string): RailgunAccount {
    const spendingNode = getWalletNodeFromKey(spendingKey);
    const viewingNode = getWalletNodeFromKey(viewingKey);
    const ethSigner = ethKey ? new Wallet(ethKey) : undefined;
    return new RailgunAccount(spendingNode, viewingNode, ethSigner);
  }

  setShieldKeyEthSigner(ethKey: string) {
    this.shieldKeyEthSigner = new Wallet(ethKey);
  }

  async init() {
    const {privateKey: viewingKey} = await this.viewingNode.getViewingKeyPair();
    const {privateKey: spendingKey} = this.spendingNode.getSpendingKeyPair();
    this.merkleTree = await MerkleTree.createTree();
    this.noteBook = new NoteBook(spendingKey, viewingKey);
  }

  async sync(provider: JsonRpcProvider, startBlock: number, cached?: Cache) {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }

    const startingBlock = cached ? cached.endBlock : startBlock > GLOBAL_START_BLOCK ? startBlock : GLOBAL_START_BLOCK;
    const endBlock = await provider.getBlockNumber();

    const newReceipts = await getAllReceipts(provider, startingBlock, endBlock);
    const receipts = cached ? Array.from(new Set(cached.receipts.concat(newReceipts))) : newReceipts;

    for (const receipt of receipts) {
      await this.noteBook.scanTX(receipt, RAILGUN_ADDRESS);
      await this.merkleTree.scanTX(receipt, RAILGUN_ADDRESS);
    }

    return {
      receipts,
      endBlock
    };
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
    const contract = new Contract(RAILGUN_ADDRESS, ABIRailgunSmartWallet);
    const data = contract.interface.encodeFunctionData('shield', [[request]]);
    return {
      to: RAILGUN_ADDRESS,
      data: data,
      value: BigInt(0),
    };
  }

  async createNativeShieldTx(value: bigint): Promise<TxData> {
    const request = await this.createShieldRequest(WETH, value);
    const contract = new Contract(RELAY_ADAPT_ADDRESS, ABIRelayAdapt);
    const payload1 = contract.interface.encodeFunctionData('wrapBase', [value]);
    const payload2 = contract.interface.encodeFunctionData('shield', [[request]]);
    const data = contract.interface.encodeFunctionData('multicall', [true, [payloadToAdaptCall(payload1), payloadToAdaptCall(payload2)]]);
    return {
      to: RELAY_ADAPT_ADDRESS,
      data: data,
      value: value,
    };
  }

  async createUnshieldTx(token: string, value: bigint, receiver: string, minGasPrice: bigint = BigInt(0)): Promise<TxData> {
    const {notesIn, notesOut} = await this.getUnshieldNotes(token, value, receiver);
    const inputs = await transact(
      this.merkleTree!,
      minGasPrice,
      1, // unshield type
      CHAIN_ID,
      ZERO_ADDRESS, // adapt contract
      new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]), // adapt params
      notesIn,
      notesOut,
    );
    const contract = new Contract(RAILGUN_ADDRESS, ABIRailgunSmartWallet);
    const data = contract.interface.encodeFunctionData('transact', [inputs]);
    return {
      to: RAILGUN_ADDRESS,
      data: data,
      value: BigInt(0),
    };
  }

  async createNativeUnshieldTx(value: bigint, receiver: string, provider: JsonRpcProvider, minGasPrice: bigint = BigInt(0)) {
    const {notesIn, notesOut, nullifiers} = await this.getUnshieldNotes(WETH, value, RELAY_ADAPT_ADDRESS, true);
    
    const dummyTx = getDummyTransactTx(nullifiers);

    const iface = new Interface(ABIRelayAdapt);
    const payload1 = iface.encodeFunctionData('unwrapBase', [0]);
    const payload2 = iface.encodeFunctionData('transfer', [[{token: {tokenType: 0, tokenAddress: ZERO_ADDRESS, tokenSubID: 0n}, to: receiver, value: 0n}]]);
    const actionData = {
      random: "0x"+ ByteUtils.randomHex(31),
      requireSuccess: true,
      minGasLimit: minGasPrice,
      calls: [payloadToAdaptCall(payload1), payloadToAdaptCall(payload2)],
    }
    
    const contract = new Contract(RELAY_ADAPT_ADDRESS, ABIRelayAdapt, provider);
    // NOTE: we have to do a view call here and it's the only function where we thus need to invoke a "provider"
    const relayAdaptParams = await contract.getAdaptParams([dummyTx], actionData); 
    const txParams = await transact(
      this.merkleTree!,
      minGasPrice,
      1, // unshield type
      CHAIN_ID,
      RELAY_ADAPT_ADDRESS,
      relayAdaptParams,
      notesIn,
      notesOut,
    );

    const relayPayload = contract.interface.encodeFunctionData('relay', [[txParams], actionData]);
    const data = contract.interface.encodeFunctionData('multicall', [true, [payloadToAdaptCall(relayPayload)]]);
    return {
      to: RELAY_ADAPT_ADDRESS,
      data: data,
      value: BigInt(0),
    };
  }

  async getUnshieldNotes(token: string, value: bigint, receiver: string, getNullifiers: boolean = false): Promise<{notesIn: Note[], notesOut: (Note | UnshieldNote)[], nullifiers: Uint8Array[]}> {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }

    const unspentNotes = await this.getUnspentNotes(token);

    const allNotes = this.noteBook.notes;
    let totalValue = 0n;
    let notesIn: Note[] = [];
    let nullifiers: Uint8Array[] = [];
    for (const note of unspentNotes) {
      totalValue += note.value;
      notesIn.push(note);
      if (getNullifiers) { nullifiers.push(await note.getNullifier(allNotes.indexOf(note))); }
      if (totalValue >= value) {
        break;
      }
    }

    if (totalValue < value) {
      throw new Error('insufficient value in unspent notes');
    }

    const tokenData = getERC20TokenData(token);

    const leftover = totalValue - value;
    const notesOut: (Note | UnshieldNote)[] = [];
    if (leftover > 0n) { 
      const changeNote = new Note(this.noteBook.spendingKey, this.noteBook.viewingKey, leftover, ByteUtils.hexStringToBytes(ByteUtils.randomHex(16)), tokenData, '');
      notesOut.push(changeNote);
    }

    notesOut.push(new UnshieldNote(receiver, value, tokenData));
    return {notesIn, notesOut, nullifiers};
  }

  async getBalance(token: string = WETH): Promise<bigint> {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }
    const tokenData = getERC20TokenData(token);
    return this.noteBook.getBalance(this.merkleTree, tokenData);
  }

  async getUnspentNotes(token: string): Promise<Note[]> {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }
    const tokenData = getERC20TokenData(token);
    const notes = await this.noteBook.getUnspentNotes(this.merkleTree, tokenData);
    return notes;
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

  getAllNotes(): Note[] {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }
    return this.noteBook.notes;
  }

  getMerkleRoot() {
    if (!this.merkleTree) {
      throw new Error('not initialized');
    }
    return this.merkleTree.root;
  }
}

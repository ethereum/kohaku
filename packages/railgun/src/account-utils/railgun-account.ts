import { deriveNodes, WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { encodeAddress } from '../railgun-lib/key-derivation/bech32';
import { Mnemonic } from '../railgun-lib/key-derivation/bip39';
import { Wallet, Contract, JsonRpcProvider, TransactionReceipt, Interface, AbiCoder } from 'ethers';
import { ShieldNoteERC20 } from '../railgun-lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { ShieldRequestStruct } from '../railgun-lib/abi/typechain/RailgunSmartWallet';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { ABIRailgunSmartWallet, ABIRelayAdapt } from '../railgun-lib/abi/abi';
import { MerkleTree } from '../railgun-logic/logic/merkletree';
import { Wallet as NoteBook } from '../railgun-logic/logic/wallet';
import { Note, TokenData, UnshieldNote } from '../railgun-logic/logic/note';
import { transact } from '../railgun-logic/logic/transaction';

const ACCOUNT_VERSION = 1;
const ACCOUNT_CHAIN_ID = undefined;
export const RAILGUN_ADDRESS = '0x942D5026b421cf2705363A525897576cFAdA5964';
export const GLOBAL_START_BLOCK = 4495479;
export const CHAIN_ID = BigInt(11155111);
export const RELAY_ADAPT_ADDRESS = '0x66af65bfff9e384796a56f3fa3709b9d5d9d7083';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const WETH = '0x97a36608DA67AF0A79e50cb6343f86F340B3b49e';
export const FEE_BASIS_POINTS = 25n;

export type TxData = {
  to: string;
  data: string;
  value: bigint;
}

const getWalletNodeFromKey = (priv: string) => {
  const wallet = new Wallet(priv);
  return new WalletNode({chainKey: wallet.privateKey, chainCode: ''});
};

function isRangeErr(e: any) {
  return (
    e?.error?.code === -32001 ||
    /failed to resolve block range/i.test(String(e?.error?.message || e?.message || ""))
  );
}

export const getAllReceipts = async (provider: JsonRpcProvider, startBlock: number, endBlock: number) => {
  const MAX_BATCH = 2000;        // start conservatively
  const MIN_BATCH = 1;
  let batch = Math.min(MAX_BATCH, Math.max(1, endBlock - startBlock + 1));
  let from = startBlock;
  const allLogs: any[] = [];

  while (from <= endBlock) {
    const to = Math.min(from + batch - 1, endBlock);
    try {
      await new Promise(r => setTimeout(r, 400)); // light pacing
      const logs = await provider.getLogs({
        address: RAILGUN_ADDRESS,
        fromBlock: from,
        toBlock: to,
      });
      allLogs.push(...logs);
      from = to + 1;                 // advance
      batch = Math.min(batch * 2, MAX_BATCH); // grow again after success
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

  const txids = [...new Set(allLogs.map(l => l.transactionHash))];
  const receipts: TransactionReceipt[] = [];
  for (const txid of txids) {
    const receipt = await provider.getTransactionReceipt(txid);
    await new Promise(r => setTimeout(r, 200));
    if (receipt) receipts.push(receipt);
  }
  return receipts;
};

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

  async syncWithReceipts(receipts: TransactionReceipt[]) {
    if (!this.noteBook || !this.merkleTree) {
      throw new Error('not initialized');
    }
    for (const receipt of receipts) {
      await this.noteBook.scanTX(receipt, RAILGUN_ADDRESS);
      await this.merkleTree.scanTX(receipt, RAILGUN_ADDRESS);
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

  async createNativeUnshieldTx(value: bigint, receiver: string, minGasPrice: bigint = BigInt(0)) {
    const {notesIn, notesOut, nullifiers} = await this.getUnshieldNotes(WETH, value, RELAY_ADAPT_ADDRESS, true);

    const iface = new Interface(ABIRelayAdapt);
    const payload1 = iface.encodeFunctionData('unwrapBase', [0]);
    const payload2 = iface.encodeFunctionData('transfer', [[{token: {tokenType: 0, tokenAddress: ZERO_ADDRESS, tokenSubID: 0n}, to: receiver, value: 0n}]]);
    const actionData = {
      random: "0x"+ ByteUtils.randomHex(31),
      requireSuccess: true,
      minGasLimit: minGasPrice,
      calls: [payloadToAdaptCall(payload1), payloadToAdaptCall(payload2)],
    }
    
    const nullifiers2D: string[][] = nullifiers.map((n) => { return [ByteUtils.hexlify(n, true)]; });
    const relayAdaptParams = getAdaptParamsHash(nullifiers2D, actionData);
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

    const contract = new Contract(RELAY_ADAPT_ADDRESS, ABIRelayAdapt);
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
    const notesIn: Note[] = [];
    const nullifiers: Uint8Array[] = [];
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

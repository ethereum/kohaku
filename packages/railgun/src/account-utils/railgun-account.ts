import { deriveNodes, WalletNode } from '../railgun-lib/key-derivation/wallet-node';
import { encodeAddress } from '../railgun-lib/key-derivation/bech32';
import { Mnemonic } from '../railgun-lib/key-derivation/bip39';
import { Wallet, Contract, JsonRpcProvider, TransactionReceipt, Interface, AbiCoder, BigNumberish } from 'ethers';
import { ShieldNoteERC20 } from '../railgun-lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { ShieldRequestStruct } from '../railgun-lib/abi/typechain/RailgunSmartWallet';
import { keccak256 } from 'ethereum-cryptography/keccak';
import { ABIRailgunSmartWallet, ABIRelayAdapt } from '../railgun-lib/abi/abi';
import { MerkleTree } from '../railgun-logic/logic/merkletree';
import { Wallet as NoteBook } from '../railgun-logic/logic/wallet';
import { Note, TokenData, UnshieldNote } from '../railgun-logic/logic/note';
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

const ACCOUNT_VERSION = 1;
const ACCOUNT_CHAIN_ID = undefined;
export const RAILGUN_ADDRESS = '0x942D5026b421cf2705363A525897576cFAdA5964';
export const GLOBAL_START_BLOCK = 4495479;
export const CHAIN_ID = BigInt(11155111);
export const RELAY_ADAPT_ADDRESS = '0x66af65bfff9e384796a56f3fa3709b9d5d9d7083';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const WETH = '0x97a36608DA67AF0A79e50cb6343f86F340B3b49e';
export const FEE_BASIS_POINTS = 25n;

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
  private merkleTrees: MerkleTree[];
  private noteBooks: NoteBook[];
  private shieldKeyEthSigner?: Wallet;

  constructor(spendingNode: WalletNode, viewingNode: WalletNode, ethSigner?: Wallet) {
    this.spendingNode = spendingNode;
    this.viewingNode = viewingNode;
    this.shieldKeyEthSigner = ethSigner;
    this.merkleTrees = [];
    this.noteBooks = [];
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

  async syncWithReceipts(receipts: TransactionReceipt[]) {
    for (const receipt of receipts) {
      await this.processReceipt(receipt);
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
    const allInputs: PublicInputs[] = [];
    for (let i = 0; i < notesIn.length; i++) {
      if (notesIn[i]!.length === 0) { continue; }
      const inputs = await transact(
        this.merkleTrees[i]!,
        minGasPrice,
        1, // unshield type
        CHAIN_ID,
        ZERO_ADDRESS, // adapt contract
        new Uint8Array([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]), // adapt params
        notesIn[i]!,
        notesOut[i]!,
      );
      allInputs.push(inputs);
    }
    const contract = new Contract(RAILGUN_ADDRESS, ABIRailgunSmartWallet);
    const data = contract.interface.encodeFunctionData('transact', [allInputs]);
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
    
    const nullifiers2D: string[][] = nullifiers.map(
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
        CHAIN_ID,
        RELAY_ADAPT_ADDRESS,
        relayAdaptParams,
        notesIn[i]!,
        notesOut[i]!,
      );
      allInputs.push(inputs);
    }

    const contract = new Contract(RELAY_ADAPT_ADDRESS, ABIRelayAdapt);
    const relayPayload = contract.interface.encodeFunctionData('relay', [allInputs, actionData]);
    const data = contract.interface.encodeFunctionData('multicall', [true, [payloadToAdaptCall(relayPayload)]]);
    return {
      to: RELAY_ADAPT_ADDRESS,
      data: data,
      value: BigInt(0),
    };
  }

  async getUnshieldNotes(token: string, value: bigint, receiver: string, getNullifiers: boolean = false): Promise<{notesIn: Note[][], notesOut: (Note | UnshieldNote)[][], nullifiers: Uint8Array[][]}> {
    const unspentNotes = await this.getUnspentNotes(token);

    const notesIn: Note[][] = [];
    const notesOut: (Note | UnshieldNote)[][] = [];
    const nullifiers: Uint8Array[][] = [];
    let totalValue = 0n;
    for (let i = 0; i < unspentNotes.length; i++) {
      const allNotes = this.noteBooks[i]!.notes;
      const iNotesIn: Note[] = [];
      const iNullifiers: Uint8Array[] = [];
      let iValue = 0n;
      for (const note of unspentNotes[i]!) {
        totalValue += note.value;
        iValue += note.value;
        iNotesIn.push(note);
        if (getNullifiers) { iNullifiers.push(await note.getNullifier(allNotes.indexOf(note))); }
        if (totalValue >= value) {
          break;
        }
      }
  
      const tokenData = getERC20TokenData(token);
  
      const iNotesOut: (Note | UnshieldNote)[] = [];
      const spendingKey = this.spendingNode.getSpendingKeyPair().privateKey;
      const viewingKey = (await this.viewingNode.getViewingKeyPair()).privateKey;
      if (totalValue > value) { 
        const changeNote = new Note(spendingKey, viewingKey, totalValue - value, ByteUtils.hexStringToBytes(ByteUtils.randomHex(16)), tokenData, '');
        iNotesOut.push(changeNote);
      }
  
      if (iValue > 0n) {
        iNotesOut.push(new UnshieldNote(receiver, value, tokenData));
      }

      notesIn.push(iNotesIn);
      notesOut.push(iNotesOut);
      nullifiers.push(iNullifiers);
      if (totalValue >= value) {
        break;
      }
    }

    if (totalValue < value) {
      throw new Error('insufficient value in unspent notes');
    }

    return {notesIn, notesOut, nullifiers};
  }

  async getBalance(token: string = WETH): Promise<bigint> {
    const tokenData = getERC20TokenData(token);
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

  async processReceipt(transaction: TransactionReceipt) {
    // KASS TODO: also scan legacy events !!!
    // Loop through each log and parse
    await Promise.all(
      transaction.logs.map(async (log) => {
        // Check if log is log of contract
        if (log.address === RAILGUN_ADDRESS) {
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
            const commitmentsLength = args.commitments.length;
            const totalLeaves = 2**16;
            const endPosition = startPosition + commitmentsLength;
            const isCrossingTreeBoundary = endPosition > totalLeaves;
            const diff = isCrossingTreeBoundary ? endPosition - totalLeaves : 0;
            const firstTreeIndexEnd = args.commitments.length - diff;
            
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

            // Create new merkleTrees and noteBooks if necessary
            if (!this.merkleTrees[treeNumber]) {
              this.merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
              this.noteBooks[treeNumber] = new NoteBook();
            }
            if (isCrossingTreeBoundary && !this.merkleTrees[treeNumber+1]) {
              this.merkleTrees[treeNumber+1] = await MerkleTree.createTree(treeNumber+1);
              this.noteBooks[treeNumber+1] = new NoteBook();
            }

            // Insert leaves
            await this.merkleTrees[treeNumber].insertLeaves(leaves.slice(0, firstTreeIndexEnd), startPosition);
            if (isCrossingTreeBoundary) {
              await this.merkleTrees[treeNumber].insertLeaves(leaves.slice(firstTreeIndexEnd, leaves.length), 0);
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
                if (startPosition+index >= totalLeaves) {
                  this.noteBooks[treeNumber+1]!.notes[startPosition+index-totalLeaves] = decrypted;
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
            const hashesLength = args.hash.length;
            const totalLeaves = 2**16;
            const endPosition = startPosition + hashesLength;
            const isCrossingTreeBoundary = endPosition > totalLeaves;
            const diff = isCrossingTreeBoundary ? endPosition - totalLeaves : 0;
            const firstTreeIndexEnd = args.hash.length - diff;

            // Get leaves
            const leaves = args.hash.map((noteHash) => hexStringToArray(noteHash));

            // Create new merkleTrees and noteBooks if necessary
            if (!this.merkleTrees[treeNumber]) {
              this.merkleTrees[treeNumber] = await MerkleTree.createTree(treeNumber);
              this.noteBooks[treeNumber] = new NoteBook();
            }
            if (isCrossingTreeBoundary && !this.merkleTrees[treeNumber+1]) {
              this.merkleTrees[treeNumber+1] = await MerkleTree.createTree(treeNumber+1);
              this.noteBooks[treeNumber+1] = new NoteBook();
            }

            // Insert leaves
            await this.merkleTrees[treeNumber]!.insertLeaves(leaves.slice(0, firstTreeIndexEnd), startPosition);
            if (isCrossingTreeBoundary) {
              await this.merkleTrees[treeNumber+1]!.insertLeaves(leaves.slice(firstTreeIndexEnd, leaves.length), 0);
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
                  if (startPosition+index >= totalLeaves) {
                    this.noteBooks[treeNumber+1]!.notes[startPosition + index - totalLeaves] = note;
                  } else {
                    this.noteBooks[treeNumber]!.notes[startPosition + index] = note;
                  }
                }
              }),
            );
          } else if (parsedLog.name === 'Nullified') {
            // Type cast to NullifiedEventObject
            const args = parsedLog.args as unknown as NullifiedEventObject;

            // Get tree number
            const treeNumber = Number(args.treeNumber.toString());
            const nullifiersFormatted = args.nullifier.map((nullifier) =>
              hexStringToArray(nullifier),
            );
            this.merkleTrees[treeNumber]!.nullifiers.push(...nullifiersFormatted);
          }
        }
      }),
    );
  }
}

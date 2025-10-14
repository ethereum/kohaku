import { Interface } from 'ethers';
import { ABIRailgunSmartWallet, ABIRelayAdapt } from '../railgun-lib/abi/abi';
import { ShieldNoteERC20 } from '../railgun-lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun-lib/utils/bytes';
import { decodeAddress } from '../railgun-lib/key-derivation/bech32';
import { MerkleTree } from '../railgun-logic/logic/merkletree';
import { Note, UnshieldNote, SendNote } from '../railgun-logic/logic/note';
import { transact, PublicInputs } from '../railgun-logic/logic/transaction';
import type { ShieldRequestStruct } from '../railgun-lib/abi/typechain/RailgunSmartWallet';
import type { RailgunNetworkConfig } from '../config';
import { ZERO_ADDRESS, ZERO_ARRAY, E_ADDRESS } from '../config';
import { getTxData, getERC20TokenData, getAdaptParamsHash } from './helpers';
import type { TxData } from './types';

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);
const RELAY_ADAPT_INTERFACE = new Interface(ABIRelayAdapt);

/**
 * Builds a shield note for depositing tokens into Railgun
 */
export async function buildShieldNote(
  masterPubkey: bigint,
  token: string,
  value: bigint
): Promise<ShieldNoteERC20> {
  return new ShieldNoteERC20(masterPubkey, ByteUtils.randomHex(16), value, token);
}

/**
 * Encodes a shield note for blockchain submission
 */
export async function encodeShieldNote(
  shieldNote: ShieldNoteERC20,
  shieldPrivateKey: Uint8Array,
  viewingPubkey: Uint8Array
): Promise<ShieldRequestStruct> {
  return shieldNote.serialize(shieldPrivateKey, viewingPubkey);
}

/**
 * Creates a transaction for shielding ERC20 tokens
 */
export async function createShieldTx(
  network: RailgunNetworkConfig,
  masterPubkey: bigint,
  shieldPrivateKey: Uint8Array,
  viewingPubkey: Uint8Array,
  token: string,
  value: bigint
): Promise<TxData> {
  const shieldNote = await buildShieldNote(masterPubkey, token, value);
  const request = await encodeShieldNote(shieldNote, shieldPrivateKey, viewingPubkey);
  const data = RAILGUN_INTERFACE.encodeFunctionData('shield', [[request]]);

  return getTxData(network.RAILGUN_ADDRESS, data);
}

/**
 * Creates a transaction for shielding native ETH (wraps to WETH first)
 */
export async function createNativeShieldTx(
  network: RailgunNetworkConfig,
  masterPubkey: bigint,
  shieldPrivateKey: Uint8Array,
  viewingPubkey: Uint8Array,
  value: bigint
): Promise<TxData> {
  const shieldNote = await buildShieldNote(masterPubkey, network.WETH, value);
  const request = await encodeShieldNote(shieldNote, shieldPrivateKey, viewingPubkey);
  const wrapTxData = getTxData(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('wrapBase', [value]));
  const shieldTxData = getTxData(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('shield', [[request]]));
  const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('multicall', [true, [wrapTxData, shieldTxData]]);

  return getTxData(network.RELAY_ADAPT_ADDRESS, data, value);
}

/**
 * Creates a transaction for shielding multiple tokens in a single call
 */
export async function createShieldTxMulti(
  network: RailgunNetworkConfig,
  masterPubkey: bigint,
  shieldPrivateKey: Uint8Array,
  viewingPubkey: Uint8Array,
  tokens: string[],
  values: bigint[]
): Promise<TxData> {
  if (tokens.length !== values.length) {
    throw new Error('tokens and values must have the same length');
  }
  let nativeValue = 0n;
  const requests: ShieldRequestStruct[] = [];
  for (let i = 0; i < tokens.length; i++) {
    let tokenToShield = tokens[i]!;
    if (tokens[i] === ZERO_ADDRESS || tokens[i] === E_ADDRESS) {
      nativeValue += values[i]!;
      tokenToShield = network.WETH;
    }
    const shieldNote = await buildShieldNote(masterPubkey, tokenToShield, values[i]!);
    requests.push(await encodeShieldNote(shieldNote, shieldPrivateKey, viewingPubkey));
  }
  if (nativeValue == 0n) {
    const data = RAILGUN_INTERFACE.encodeFunctionData('shield', [requests]);
    return getTxData(network.RAILGUN_ADDRESS, data);
  }

  const wrapTxData = getTxData(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('wrapBase', [nativeValue]));
  const shieldTxData = getTxData(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('shield', [requests]));
  const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('multicall', [true, [wrapTxData, shieldTxData]]);

  return getTxData(network.RELAY_ADAPT_ADDRESS, data, nativeValue);
}

/**
 * Creates a transaction for unshielding tokens from Railgun to an Ethereum address
 */
export async function createUnshieldTx(
  network: RailgunNetworkConfig,
  merkleTrees: MerkleTree[],
  notesIn: Note[][],
  notesOut: (Note | UnshieldNote | SendNote)[][],
  minGasPrice: bigint = BigInt(0)
): Promise<TxData> {
  const allInputs: PublicInputs[] = [];
  for (let i = 0; i < notesIn.length; i++) {
    if (notesIn[i]!.length === 0) { continue; }
    const inputs = await transact(
      merkleTrees[i]!,
      minGasPrice,
      1, // unshield type
      network.CHAIN_ID,
      ZERO_ADDRESS, // adapt contract
      ZERO_ARRAY, // adapt params
      notesIn[i]!,
      notesOut[i]!,
    );
    allInputs.push(inputs);
  }
  const data = RAILGUN_INTERFACE.encodeFunctionData('transact', [allInputs]);

  return getTxData(network.RAILGUN_ADDRESS, data);
}

/**
 * Creates a transaction for unshielding native ETH (unwraps WETH to ETH)
 */
export async function createNativeUnshieldTx(
  network: RailgunNetworkConfig,
  merkleTrees: MerkleTree[],
  notesIn: Note[][],
  notesOut: (Note | UnshieldNote | SendNote)[][],
  nullifiers: Uint8Array[][],
  receiver: string,
  minGasPrice: bigint = BigInt(0)
): Promise<TxData> {
  const unwrapTxData = getTxData(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('unwrapBase', [0]));
  const ethTransfer = [{token: {tokenType: 0, tokenAddress: ZERO_ADDRESS, tokenSubID: 0n}, to: receiver, value: 0n}];
  const transferTxData = getTxData(network.RELAY_ADAPT_ADDRESS, RELAY_ADAPT_INTERFACE.encodeFunctionData('transfer', [ethTransfer]));
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
      merkleTrees[i]!,
      minGasPrice,
      1, // unshield type
      network.CHAIN_ID,
      network.RELAY_ADAPT_ADDRESS,
      relayAdaptParams,
      notesIn[i]!,
      notesOut[i]!,
    );
    allInputs.push(inputs);
  }
  const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('relay', [allInputs, actionData]);

  return getTxData(network.RELAY_ADAPT_ADDRESS, data);
}

/**
 * Creates a private transfer transaction within Railgun (from one 0zk address to another)
 */
export async function createPrivateTransferTx(
  network: RailgunNetworkConfig,
  merkleTrees: MerkleTree[],
  notesIn: Note[][],
  notesOut: (Note | UnshieldNote | SendNote)[][],
  minGasPrice: bigint = BigInt(0)
): Promise<TxData> {
  const allInputs: PublicInputs[] = [];
  for (let i = 0; i < notesIn.length; i++) {
    if (notesIn[i]!.length === 0) { continue; }
    const inputs = await transact(
      merkleTrees[i]!,
      minGasPrice,
      0, // no unshield
      network.CHAIN_ID,
      ZERO_ADDRESS, // adapt contract
      ZERO_ARRAY, // adapt params
      notesIn[i]!,
      notesOut[i]!,
    );
    allInputs.push(inputs);
  }
  const data = RAILGUN_INTERFACE.encodeFunctionData('transact', [allInputs]);

  return getTxData(network.RAILGUN_ADDRESS, data);
}

/**
 * Prepares input and output notes for a transaction by selecting unspent notes
 */
export async function prepareTransactionNotes(
  merkleTrees: MerkleTree[],
  noteBooks: { notes: Note[] }[],
  unspentNotesByTree: Note[][],
  spendingKey: Uint8Array,
  viewingKey: Uint8Array,
  token: string,
  value: bigint,
  receiver: string,
  getNullifiers: boolean = false
): Promise<{notesIn: Note[][], notesOut: (Note | UnshieldNote | SendNote)[][], nullifiers: Uint8Array[][]}> {
  const isUnshield = receiver.startsWith("0x");
  if (!isUnshield && !receiver.startsWith("0zk")) {
    throw new Error('receiver must be an ethereum 0x address or a railgun 0zk address');
  }

  const notesIn: Note[][] = [];
  const notesOut: (Note | UnshieldNote | SendNote)[][] = [];
  const nullifiers: Uint8Array[][] = [];
  let totalValue = 0n;
  let valueSpent = 0n;

  for (let i = 0; i < unspentNotesByTree.length; i++) {
    const treeNotesIn: Note[] = [];
    const treeNullifiers: Uint8Array[] = [];
    let treeValue = 0n;

    for (const note of unspentNotesByTree[i]!) {
      totalValue += note.value;
      treeValue += note.value;
      treeNotesIn.push(note);
      if (getNullifiers) {
        const noteIndex = noteBooks[i]!.notes.indexOf(note);
        if (noteIndex >= 0) {
          treeNullifiers.push(await note.getNullifier(noteIndex));
        }
      }
      if (totalValue >= value) {
        break;
      }
    }

    const tokenData = getERC20TokenData(token);

    const treeNotesOut: (Note | UnshieldNote | SendNote)[] = [];
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

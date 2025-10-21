import { Interface } from 'ethers';
import { ABIRailgunSmartWallet } from '../../railgun/lib/abi/abi';
import { ZERO_ADDRESS, ZERO_ARRAY } from '../../config';
import { getTxData } from '../../utils/account';
import type { RailgunNetworkConfig } from '../../config';
import type { TxData } from '../../account';
import type { Note, UnshieldNote, SendNote } from '../../railgun/logic/logic/note';
import type { MerkleTree } from '../../railgun/logic/logic/merkletree';
import { decodeRailgunAddress } from '../address';
import { transact, PublicInputs } from '../../railgun/logic/logic/transaction';

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);

export const createUnshieldTx = async (
  network: RailgunNetworkConfig,
  merkleTrees: MerkleTree[],
  notesIn: Note[][],
  notesOut: (Note | UnshieldNote | SendNote)[][],
  minGasPrice: bigint,
): Promise<TxData> => {
  const allInputs: PublicInputs[] = [];

  for (let i = 0; i < notesIn.length; i++) {
    if (notesIn[i]!.length === 0) continue;

    const inputs = await transact(
      merkleTrees[i]!,
      minGasPrice,
      1,
      network.CHAIN_ID,
      ZERO_ADDRESS,
      ZERO_ARRAY,
      notesIn[i]!,
      notesOut[i]!,
    );

    allInputs.push(inputs);
  }

  const data = RAILGUN_INTERFACE.encodeFunctionData('transact', [allInputs]);

  return getTxData(network.RAILGUN_ADDRESS, data);
};

export const createPrivateTransferTx = async (
  network: RailgunNetworkConfig,
  merkleTrees: MerkleTree[],
  notesIn: Note[][],
  notesOut: (Note | UnshieldNote | SendNote)[][],
  minGasPrice: bigint,
): Promise<TxData> => {
  const allInputs: PublicInputs[] = [];

  for (let i = 0; i < notesIn.length; i++) {
    if (notesIn[i]!.length === 0) continue;

    const inputs = await transact(
      merkleTrees[i]!,
      minGasPrice,
      0,
      network.CHAIN_ID,
      ZERO_ADDRESS,
      ZERO_ARRAY,
      notesIn[i]!,
      notesOut[i]!,
    );

    allInputs.push(inputs);
  }

  const data = RAILGUN_INTERFACE.encodeFunctionData('transact', [allInputs]);

  return getTxData(network.RAILGUN_ADDRESS, data);
};

export const decodeReceiver = (receiver: string) => {
  return decodeRailgunAddress(receiver);
};

import { Interface } from 'ethers';
import { ABIRelayAdapt } from '../../railgun/lib/abi/abi';
import { ByteUtils } from '../../railgun/lib/utils/bytes';
import { ZERO_ADDRESS } from '../../config';
import { getTxData, getAdaptParamsHash } from '../../utils/account';
import type { RailgunNetworkConfig } from '../../config';
import type { TxData } from '../../account';
import type { Note, UnshieldNote, SendNote } from '../../railgun/logic/logic/note';
import type { MerkleTree } from '../../railgun/logic/logic/merkletree';
import { transact, PublicInputs } from '../../railgun/logic/logic/transaction';

const RELAY_ADAPT_INTERFACE = new Interface(ABIRelayAdapt);

export const createNativeUnshieldTx = async (
  network: RailgunNetworkConfig,
  merkleTrees: MerkleTree[],
  notesIn: Note[][],
  notesOut: (Note | UnshieldNote | SendNote)[][],
  nullifiers: Uint8Array[][],
  receiver: string,
  minGasPrice: bigint,
): Promise<TxData> => {
  const unwrapCall = {
    to: network.RELAY_ADAPT_ADDRESS,
    data: RELAY_ADAPT_INTERFACE.encodeFunctionData('unwrapBase', [0]),
    value: 0n,
  };
  const ethTransfer = [{
    token: { tokenType: 0, tokenAddress: ZERO_ADDRESS, tokenSubID: 0n },
    to: receiver,
    value: 0n,
  }];
  const transferCall = {
    to: network.RELAY_ADAPT_ADDRESS,
    data: RELAY_ADAPT_INTERFACE.encodeFunctionData('transfer', [ethTransfer]),
    value: 0n,
  };
  const actionData = {
    random: `0x${ByteUtils.randomHex(31)}`,
    requireSuccess: true,
    minGasLimit: minGasPrice,
    calls: [unwrapCall, transferCall],
  };
  const nonEmptyNullifiers = nullifiers.filter((arr) => arr.length > 0);
  const nullifiers2D = nonEmptyNullifiers.map((arr) =>
    arr.map((n) => ByteUtils.hexlify(n, true)),
  );
  const relayAdaptParams = getAdaptParamsHash(nullifiers2D, actionData);
  const allInputs: PublicInputs[] = [];

  for (let i = 0; i < notesIn.length; i++) {
    if (notesIn[i]!.length === 0) continue;

    const inputs = await transact(
      merkleTrees[i]!,
      minGasPrice,
      1,
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
};

import { Interface } from 'ethers';
import { ABIRailgunSmartWallet, ABIRelayAdapt } from '../railgun/lib/abi/abi';
import { ShieldNoteERC20 } from '../railgun/lib/note/erc20/shield-note-erc20';
import { ByteUtils } from '../railgun/lib/utils/bytes';
import type { ShieldRequestStruct } from '../railgun/lib/abi/typechain/RailgunSmartWallet';
import type { RailgunNetworkConfig } from '../config';
import { ZERO_ADDRESS, E_ADDRESS } from '../config';
import { getTxData } from '../utils/account';
import type { TxData } from '../account';
import { decodeRailgunAddress } from './address';

const RAILGUN_INTERFACE = new Interface(ABIRailgunSmartWallet);
const RELAY_ADAPT_INTERFACE = new Interface(ABIRelayAdapt);

export const buildShieldNote = async (
  masterPubkey: bigint,
  token: string,
  value: bigint,
): Promise<ShieldNoteERC20> => {
  return new ShieldNoteERC20(masterPubkey, ByteUtils.randomHex(16), value, token);
};

export const encodeShieldNote = async (
  shieldNote: ShieldNoteERC20,
  shieldPrivateKey: Uint8Array,
  viewingPubkey: Uint8Array,
): Promise<ShieldRequestStruct> => {
  return shieldNote.serialize(shieldPrivateKey, viewingPubkey);
};

export const createShieldTx = async (
  network: RailgunNetworkConfig,
  masterPubkey: bigint,
  shieldPrivateKey: Uint8Array,
  viewingPubkey: Uint8Array,
  token: string,
  value: bigint,
): Promise<TxData> => {
  const shieldNote = await buildShieldNote(masterPubkey, token, value);
  const request = await encodeShieldNote(shieldNote, shieldPrivateKey, viewingPubkey);
  const data = RAILGUN_INTERFACE.encodeFunctionData('shield', [[request]]);

  return getTxData(network.RAILGUN_ADDRESS, data);
};

export const createNativeShieldTx = async (
  network: RailgunNetworkConfig,
  masterPubkey: bigint,
  shieldPrivateKey: Uint8Array,
  viewingPubkey: Uint8Array,
  value: bigint,
): Promise<TxData> => {
  const shieldNote = await buildShieldNote(masterPubkey, network.WETH, value);
  const request = await encodeShieldNote(shieldNote, shieldPrivateKey, viewingPubkey);

  const wrapCall = {
    to: network.RELAY_ADAPT_ADDRESS,
    data: RELAY_ADAPT_INTERFACE.encodeFunctionData('wrapBase', [value]),
    value: 0n,
  };
  const shieldCall = {
    to: network.RELAY_ADAPT_ADDRESS,
    data: RELAY_ADAPT_INTERFACE.encodeFunctionData('shield', [[request]]),
    value: 0n,
  };
  const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('multicall', [true, [wrapCall, shieldCall]]);

  return getTxData(network.RELAY_ADAPT_ADDRESS, data, value);
};

export const createShieldTxMulti = async (
  network: RailgunNetworkConfig,
  masterPubkey: bigint,
  shieldPrivateKey: Uint8Array,
  viewingPubkey: Uint8Array,
  tokens: string[],
  values: bigint[],
): Promise<TxData> => {
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

  if (nativeValue === 0n) {
    const data = RAILGUN_INTERFACE.encodeFunctionData('shield', [requests]);

    return getTxData(network.RAILGUN_ADDRESS, data);
  }

  const wrapCall = {
    to: network.RELAY_ADAPT_ADDRESS,
    data: RELAY_ADAPT_INTERFACE.encodeFunctionData('wrapBase', [nativeValue]),
    value: 0n,
  };
  const shieldCall = {
    to: network.RELAY_ADAPT_ADDRESS,
    data: RELAY_ADAPT_INTERFACE.encodeFunctionData('shield', [requests]),
    value: 0n,
  };
  const data = RELAY_ADAPT_INTERFACE.encodeFunctionData('multicall', [true, [wrapCall, shieldCall]]);

  return getTxData(network.RELAY_ADAPT_ADDRESS, data, nativeValue);
};

export { decodeRailgunAddress };
export { decodeRailgunAddress as decodeReceiver };

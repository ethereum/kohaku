import { bytesToHex } from 'ethereum-cryptography/utils';
import { poseidon } from '../utils/poseidon';
import { KeyNode } from '../models/engine-types';
import { childKeyDerivationHardened, getMasterKeyFromSeed, getPathSegments } from './bip32';
import { ByteUtils } from '../utils/bytes';
import { Mnemonic } from './bip39';
import { getPublicSpendingKey, getPublicViewingKey } from '../utils/keys-utils';

const HARDENED_OFFSET = 0x80000000;

export type WalletNodes = { spending: WalletNode; viewing: WalletNode };

/**
 * constant defining the derivation path prefixes for spending and viewing keys
 * must be appended with index' to form a complete path
 */
const DERIVATION_PATH_PREFIXES = {
  SPENDING: "m/44'/1984'/0'/0'/",
  VIEWING: "m/420'/1984'/0'/0'/",
};

/**
 * Helper to append DERIVATION_PATH_PREFIXES with index'
 */
const derivePathsForIndex = (index: number = 0) => {
  return {
    spending: `${DERIVATION_PATH_PREFIXES.SPENDING}${index}'`,
    viewing: `${DERIVATION_PATH_PREFIXES.VIEWING}${index}'`,
  };
};

export const deriveNodes = (mnemonic: string, index: number = 0): WalletNodes => {
  const paths = derivePathsForIndex(index);
  return {
    // eslint-disable-next-line no-use-before-define
    spending: WalletNode.fromMnemonic(mnemonic).derive(paths.spending),
    // eslint-disable-next-line no-use-before-define
    viewing: WalletNode.fromMnemonic(mnemonic).derive(paths.viewing),
  };
};

export type SpendingPublicKey = [bigint, bigint];
export type SpendingKeyPair = { privateKey: Uint8Array; pubkey: SpendingPublicKey };
export type ViewingKeyPair = { privateKey: Uint8Array; pubkey: Uint8Array };

export class WalletNode {
  private chainKey: string;

  private chainCode: string;

  constructor(keyNode: KeyNode) {
    this.chainKey = keyNode.chainKey;
    this.chainCode = keyNode.chainCode;
  }

  /**
   * Create BIP32 node from mnemonic
   * @returns {WalletNode}
   */
  static fromMnemonic(mnemonic: string): WalletNode {
    const seed = Mnemonic.toSeed(mnemonic);
    return new WalletNode(getMasterKeyFromSeed(seed));
  }

  /**
   * Derives new BIP32Node along path
   * @param {string} path - path to derive along
   * @returns {BIP32Node} - new BIP32 implementation Node
   */
  derive(path: string): WalletNode {
    // Get path segments
    const segments = getPathSegments(path);

    // Calculate new key node
    const keyNode = segments.reduce(
      (parentKeys: KeyNode, segment: number) =>
        childKeyDerivationHardened(parentKeys, segment, HARDENED_OFFSET),
      {
        chainKey: this.chainKey,
        chainCode: this.chainCode,
      },
    );
    return new WalletNode(keyNode);
  }

  /**
   * Get spending key-pair
   * @returns keypair
   */
  getSpendingKeyPair(): SpendingKeyPair {
    const privateKey = ByteUtils.hexStringToBytes(this.chainKey);
    const pubkey = getPublicSpendingKey(privateKey);
    return {
      privateKey,
      pubkey,
    };
  }

  static getMasterPublicKey(spendingPublicKey: [bigint, bigint], nullifyingKey: bigint): bigint {
    return poseidon([...spendingPublicKey, nullifyingKey]);
  }

  async getViewingKeyPair(): Promise<ViewingKeyPair> {
    // TODO: THIS should be a separate node chainkey
    const privateKey = ByteUtils.hexStringToBytes(this.chainKey);
    const pubkey = await getPublicViewingKey(privateKey);
    return { privateKey, pubkey };
  }

  async getNullifyingKey(): Promise<bigint> {
    const { privateKey } = await this.getViewingKeyPair();
    return poseidon([ByteUtils.hexToBigInt(bytesToHex(privateKey))]);
  }
}

import { Wallet } from "ethers";
import { match } from "ts-pattern";
import { UnionRequiredBy } from "viem";

import {
  deriveNodes,
  Mnemonic,
  WalletNode,
} from "~/railgun/lib/key-derivation";

export type KeyConfig = UnionRequiredBy<
  KeyConfigMnemonic | KeyConfigPrivateKey,
  "type"
>;

export type KeyConfigMnemonic = {
  type: "mnemonic";
  mnemonic: string;
  accountIndex: number;
};

export type KeyConfigPrivateKey = {
  type: "key";
  spendingKey: string;
  viewingKey: string;
  ethKey?: string;
};

export type DerivedKeys = {
  spending: WalletNode;
  viewing: WalletNode;
  master: bigint;
  signer?: Wallet;
};

export const getWalletNodeFromPrivateKey = (privateKey: string): WalletNode => {
  const wallet = new Wallet(privateKey);

  return new WalletNode({ chainKey: wallet.privateKey, chainCode: "" });
};

export const getMasterPublicKey = async (
  spending: WalletNode,
  viewing: WalletNode
) => {
  const { pubkey } = spending.getSpendingKeyPair();
  const nullifyingKey = await viewing.getNullifyingKey();

  return WalletNode.getMasterPublicKey(pubkey, nullifyingKey);
};

export const deriveKeysFromMnemonic: (
  config: KeyConfigMnemonic
) => Promise<DerivedKeys> = async ({ mnemonic, accountIndex }) => {
  const { spending, viewing } = deriveNodes(mnemonic, accountIndex);
  const master = await getMasterPublicKey(spending, viewing);
  const signer = new Wallet(Mnemonic.to0xPrivateKey(mnemonic, accountIndex));

  return { spending, viewing, signer, master };
};

export const deriveKeysFromPrivateKeys: (
  config: KeyConfigPrivateKey
) => Promise<DerivedKeys> = async ({ spendingKey, viewingKey, ethKey }) => {
  const spending = getWalletNodeFromPrivateKey(spendingKey);
  const viewing = getWalletNodeFromPrivateKey(viewingKey);
  const master = await getMasterPublicKey(spending, viewing);
  const signer = ethKey ? new Wallet(ethKey) : undefined;

  return { spending, viewing, signer, master };
};

export const deriveKeys = async (config: KeyConfig) =>
  match(config)
    .with({ type: "mnemonic" }, deriveKeysFromMnemonic)
    .with({ type: "key" }, deriveKeysFromPrivateKeys)
    .exhaustive();

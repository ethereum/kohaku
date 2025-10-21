import { Wallet } from 'ethers';
import { WalletNode } from '../../railgun/lib/key-derivation/wallet-node';

export const getWalletNodeFromKey = (privateKey: string): WalletNode => {
  const wallet = new Wallet(privateKey);

  return new WalletNode({ chainKey: wallet.privateKey, chainCode: '' });
};

export const derivePrivateKeyNodes = (privateKey: string) => {
  const spendingNode = getWalletNodeFromKey(privateKey);
  const viewingNode = getWalletNodeFromKey(privateKey);

  return { spendingNode, viewingNode };
};

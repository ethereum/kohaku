import type { BigNumberish } from 'ethers';
import type {
  CommitmentCiphertextStructOutput,
  ShieldCiphertextStructOutput,
  CommitmentPreimageStructOutput
} from '../railgun-logic/typechain-types/contracts/logic/RailgunLogic';

export type ChainId = '1' | '11155111';

export type TxData = {
  to: string;
  data: string;
  value: bigint;
}

export type Call = {
  to: string;
  data: string;
  value: bigint | number | string;
};

export type ActionData = {
  random: string;
  requireSuccess: boolean;
  minGasLimit: bigint | number | string;
  calls: Call[];
};

export enum TokenType {
  ERC20 = 0,
  ERC721 = 1,
  ERC1155 = 2,
}

export interface TransactEventObject {
  treeNumber: BigNumberish;
  startPosition: BigNumberish;
  hash: string[];
  ciphertext: CommitmentCiphertextStructOutput[];
}

export interface ShieldEventObject {
  treeNumber: BigNumberish;
  startPosition: BigNumberish;
  commitments: CommitmentPreimageStructOutput[];
  shieldCiphertext: ShieldCiphertextStructOutput[];
  fees: BigNumberish[];
}

export interface NullifiedEventObject {
  treeNumber: number;
  nullifier: string[];
}

export interface RailgunLog {
  blockNumber: number;
  topics: string[];
  data: string;
  address: string;
}

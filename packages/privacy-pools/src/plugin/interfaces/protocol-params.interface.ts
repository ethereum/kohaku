import { CommitmentPublicSignals, Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { ChainId, PrivateOperation, PublicOperation } from '@kohaku-eth/plugins';
import { TxData } from '@kohaku-eth/provider';

import { ISecretManager, SecretManagerParams } from "../../account/keys";
import { IAspService } from "../../data/asp.interface.js";
import { IDepositWithBalance } from "../../data/interfaces/events.interface";
import { Address } from "../../interfaces/types.interface";
import { IQuoteResponse, IRelayData, IRelayerClient, WithdrawalPayload } from '../../relayer/interfaces/relayer-client.interface';
import { RootState } from "../../state";
import { SpecificAssetBalanceFn } from "../../state/selectors/balance.selector";
import { StoreFactoryParams } from "../../state/state-manager";
import { WithdrawProveOutput } from "../../state/thunks/withdrawThunk";

export interface PPv1PrivateOperation extends PrivateOperation {
  rawData: {
    context: bigint,
    relayData: IRelayData,
    proof: WithdrawProveOutput;
    withdrawalPayload: WithdrawalPayload;
    chainId: bigint;
    scope: bigint;
  };
  txData: TxData;
  quoteData: {
    quote: IQuoteResponse;
    relayerId: string;
  };
}

export interface PPv1PublicOperation extends PublicOperation {
  txns: TxData[];
}

export interface IEntrypoint {
  address: Address;
  deploymentBlock: bigint;
}

export interface PrivacyPoolsV1ProtocolParams {
  accountIndex?: number;
  secretManager: (params: SecretManagerParams) => ISecretManager;
  stateManager: (params: StoreFactoryParams) => IStateManager;
  relayerClientFactory: () => IRelayerClient;
  entrypoint: IEntrypoint;
  aspServiceFactory: () => IAspService;
  proverFactory: () => ReturnType<typeof Prover>;
  relayersList: Record<string, string>;
  initialState?: Record<string, RootState>;
  ipfsUrl?: string;
}

interface IBaseOperationParams { }  // eslint-disable-line @typescript-eslint/no-empty-object-type

export interface IDepositOperationParams extends IBaseOperationParams {
  asset: Address;
  amount: bigint;
}

export interface IGetBalancesOperationParams extends IBaseOperationParams {
  assets?: Address[];
  balanceType?: 'approved' | 'unapproved';
}

export interface IWithdrawapOperationParams extends Omit<IDepositOperationParams, 'amount'> {
  amount?: bigint;
  recipient: Address;
}

export interface IRagequitAssetsOperationParams extends IBaseOperationParams {
  assets?: Address[];
}

export interface IRagequitLabelsOperationParams extends IBaseOperationParams {
  labels: INote["label"][];
}

export interface IGetNotesParams extends IBaseOperationParams {
  includeSpent?: boolean;
  assets?: Address[];
}

export type INote = Pick<IDepositWithBalance,
  "label" | "precommitment" | "value" | "balance" | "assetAddress" | "approved"
> & {
  // deposit index
  deposit: number;
  // withdraw index
  withdraw: number;
};

export type StateWithdrawalPayload = {
  withdrawalInfo: {
    context: bigint;
    scope: bigint;
    relayDataAbi: string;
    relayDataObject: IRelayData;
    withdrawalObject: WithdrawalPayload;
  };
  proofResult: WithdrawProveOutput,
  quoteData: { quote: IQuoteResponse, relayerId: string; };
  chainId: ChainId;
};

export type ProveOutput = Awaited<ReturnType<Awaited<ReturnType<typeof Prover>>['prove']>>;
export type CommitmentProveOutput = Omit<ProveOutput, 'mappedSignals'> & {
  mappedSignals: CommitmentPublicSignals;
};

export type StateRagequitPayload = {
  note: INote;
  poolAddress: Address;
  proofResult: CommitmentProveOutput;
};

export type StoreKey = `${string}-${string}`;
export type StoreStorageKey = `privacy-pool-state-${StoreKey}`;

export interface IStateManager {
  /**
   * Queries the chain and updates its state
   */
  sync: () => Promise<void>;
  /**
   * Generates a deposit payload for the signer
   */
  getDepositPayload: (params: IDepositOperationParams) => Promise<TxData>;
  /**
   * Generates the relayer quotes and withdrawals payloads for the specified amount
   */
  getWithdrawalPayloads: (params: IWithdrawapOperationParams) => Promise<StateWithdrawalPayload[]>;
  /**
   * Generates the ragequit payloads for the specified assets. Only unapproved
   * amount will be ragequitted.
   */
  getRagequitPayloads: (params: IRagequitAssetsOperationParams) => Promise<StateRagequitPayload[]>;
  /**
   * Generates the ragequit payloads for the specified assets. Only unapproved
   * amount will be ragequitted.
   */
  getRagequitByLabelPayloads: (params: IRagequitLabelsOperationParams) => Promise<StateRagequitPayload[]>;
  /**
   * Gets the balance of the specified assets.
   * All assets if not specified.
   */
  getBalances: SpecificAssetBalanceFn<true>;
  dumpState: () => Record<StoreStorageKey, RootState>;
  /**
   * Gets all notes for the account.
   * @param includeSpent - If true, include notes with zero balance
   * @param assets - Optional filter by specific assets
   */
  getNotes: (params: IGetNotesParams) => Promise<INote[]>;
}

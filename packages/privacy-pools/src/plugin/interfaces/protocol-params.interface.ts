import { CommitmentPublicSignals, Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { ChainId, PrivateOperation, PublicOperation, UnshieldOptions } from '@kohaku-eth/plugins';
import { TxData } from '@kohaku-eth/provider';

import { ISecretManager, SecretManagerParams } from "../../account/keys";
import { IAspService } from "../../data/asp.interface.js";
import { IDataService } from "../../data/interfaces/data.service.interface";
import { IDepositWithBalance } from "../../data/interfaces/events.interface";
import { Address } from "../../interfaces/types.interface";
import { DelegationConfig } from "../../interfaces/user-ops.interface";
import { IGenericPaymasterWithdrawalPayload } from "../../relayer/interfaces/paymaster-client.interface";
import { IQuoteResponse, IRelayData, IRelayerClient, WithdrawalPayload } from '../../relayer/interfaces/relayer-client.interface';
import { PublicRootState } from "../../state/store";
import { SpecificAssetBalanceFn } from "../../state/selectors/balance.selector";
import { StoreFactoryParams } from "../../state/state-manager";
import { WithdrawProveOutput } from "../../state/thunks/withdrawThunk";

/** Withdrawal via a relayer that fronts gas (the default path). */
export interface PPv1RelayerPrivateOperation extends PrivateOperation {
  mode?: 'relayer';
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

/** Withdrawal sponsored by a paymaster via an ERC-4337 userOp. */
export interface PPv1PaymasterPrivateOperation extends PrivateOperation {
  mode: 'paymaster';
  withdrawal: IGenericPaymasterWithdrawalPayload;
}

export type PPv1PrivateOperation =
  | PPv1RelayerPrivateOperation
  | PPv1PaymasterPrivateOperation;

/** Per-chain paymaster wiring. `poolsAccountsMap` routes a pool address (lowercase hex) to its adapter. */
export interface IPaymasterConfig {
  bundlerUrl: string;
  entryPointAddress: `0x${string}`;
  paymasterAddress: `0x${string}`;
  poolsAccountsMap: Record<string, `0x${string}`>;
}

export type IChainsPaymastersConfig = Record<number, IPaymasterConfig>;

/** Extra `prepareUnshield` options: choose the broadcast path and, for paymaster, the sender derivation. */
export interface PPv1UnshieldOptions extends UnshieldOptions {
  mode?: 'relayer' | 'paymaster';
  delegation?: DelegationConfig;
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
  initialState?: () => Promise<Record<string, PublicRootState>>;
  ipfsUrl?: string;
  paymasterConfig?: IChainsPaymastersConfig;
  /** Optional pre-built data service (e.g. a saga-sync-backed one used to speed up hydration in tests). */
  dataService?: IDataService;
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

export interface IPaymasterWithdrawapOperationParams extends IWithdrawapOperationParams {
  delegation?: DelegationConfig;
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
   * Generates paymaster-sponsored withdrawal payloads (fully built + signed userOps)
   * for the specified amount. No relayer is involved.
   */
  getPaymasterWithdrawalPayloads: (
    params: IPaymasterWithdrawapOperationParams,
  ) => Promise<IGenericPaymasterWithdrawalPayload[]>;
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
  dumpState: () => Record<StoreStorageKey, PublicRootState>;
  /**
   * Gets all notes for the account.
   * @param includeSpent - If true, include notes with zero balance
   * @param assets - Optional filter by specific assets
   */
  getNotes: (params: IGetNotesParams) => Promise<INote[]>;
}

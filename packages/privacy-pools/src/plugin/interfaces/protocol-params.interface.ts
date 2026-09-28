/* eslint-disable max-lines */
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
  /** Present only for exact-output unshields (`options.exact`): the resolved gross/net/fee. */
  exact?: PPv1ExactUnshieldResult;
}

/** Withdrawal sponsored by a paymaster via an ERC-4337 userOp. */
export interface PPv1PaymasterPrivateOperation extends PrivateOperation {
  mode: 'paymaster';
  withdrawal: IGenericPaymasterWithdrawalPayload;
  /** Present only for exact-output unshields (`options.exact`): the resolved gross/net/fee. */
  exact?: PPv1ExactUnshieldResult;
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
  /** Gas budget for the paymaster execution phase when `tailCalls` are supplied. */
  tailCallsGasEstimate?: bigint;
  /**
   * Opt into exact-output mode: `amount` is read as the amount the recipient must
   * receive (net), the gross is sized to cover the fee, and the built operation is
   * re-checked against the committed fee. See {@link PPv1ExactUnshieldOptions}.
   */
  exact?: PPv1ExactUnshieldOptions;
}

/** Cost of a shield (deposit). Amounts are in the pool asset's base units; network gas is not included. */
export interface PPv1ShieldEstimate {
  /** Entrypoint vetting fee deducted from the deposit. */
  fee: bigint;
  /** Amount credited to the note after the vetting fee. */
  netAmount: bigint;
  vettingFeeBPS: bigint;
  /** Deposits below this amount revert. */
  minimumDeposit: bigint;
}

/** Relayer withdrawal cost, from the best relayer quote. The relayer fronts gas; `fee` covers it. */
export interface PPv1RelayerUnshieldEstimate {
  mode: 'relayer';
  /** Fee deducted from the withdrawn amount, in the pool asset's base units. */
  fee: bigint;
  /** Amount the recipient receives. */
  netAmount: bigint;
  /** Relay fee committed in the relayer's signed withdrawal data. */
  feeBPS: bigint;
  relayerId: string;
  /** Quote expiration timestamp (ms). `prepareUnshield` requests a fresh quote. */
  expiration: number;
}

/**
 * Paymaster withdrawal cost at baseline gas limits and the bundler's current gas
 * price. `prepareUnshield` refines gas against the bundler, so the final fee may differ slightly.
 */
export interface PPv1PaymasterUnshieldEstimate {
  mode: 'paymaster';
  /** Sponsored gas fee deducted from the withdrawn amount, in the pool asset's base units. */
  fee: bigint;
  /** Amount the recipient receives. */
  netAmount: bigint;
  /** The same fee in wei, before pricing it into the pool asset. */
  gasFeeWei: bigint;
  maxFeePerGas: bigint;
}

export type PPv1UnshieldEstimate = PPv1RelayerUnshieldEstimate | PPv1PaymasterUnshieldEstimate;

export type PPv1EstimateUnshieldOptions = Pick<PPv1UnshieldOptions, 'mode' | 'tailCalls' | 'tailCallsGasEstimate'>;

/** Exact-output settings, passed as `prepareUnshield`'s `options.exact`. Its presence enables exact-output mode. */
export interface PPv1ExactUnshieldOptions {
  /**
   * Maximum shortfall tolerated between the requested output and what the
   * recipient actually receives, in basis points of the requested output. Fees
   * can move between estimate and execution (the relayer re-quotes, paymaster gas
   * is refined against the bundler), so the built operation is re-checked against
   * this bound and aborts if it would fall short. Defaults to 0 (no shortfall).
   */
  slippageBPS?: bigint;
}

/** Resolved amounts for an exact-output unshield, attached to the returned operation as `exact`. */
export interface PPv1ExactUnshieldResult {
  /** Amount withdrawn from the pool (gross). */
  grossAmount: bigint;
  /** Requested recipient output (the `amount` passed in). `expectedNet >= requestedNet` on success. */
  requestedNet: bigint;
  /** Amount the recipient will receive after fees, read from the built operation. */
  expectedNet: bigint;
  /** Fee deducted from the gross, in the pool asset's base units. */
  fee: bigint;
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
  tailCalls?: (sender: `0x${string}`) => Promise<TxData[]>;
  tailCallsGasEstimate?: bigint;
}

export interface IEstimateUnshieldOperationParams extends IDepositOperationParams {
  recipient: Address;
  mode?: PPv1EstimateUnshieldOptions['mode'];
  /** Whether the withdrawal carries tail calls (they add an execution phase to the paymaster userOp). */
  hasTailCalls?: boolean;
  tailCallsGasEstimate?: bigint;
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
   * Computes the vetting fee for a deposit from the Entrypoint's current asset config
   */
  getShieldEstimate: (params: IDepositOperationParams) => Promise<PPv1ShieldEstimate>;
  /**
   * Computes the withdrawal fee (relayer quote or paymaster gas) without generating a proof
   */
  getUnshieldEstimate: (params: IEstimateUnshieldOperationParams) => Promise<PPv1UnshieldEstimate>;
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

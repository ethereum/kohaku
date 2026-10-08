/* eslint-disable max-lines */
import { CommitmentPublicSignals, Prover } from "@fatsolutions/privacy-pools-core-circuits";
import { AccountId, ChainId, PrivateOperation, PublicOperation, UnshieldOptions } from '@kohaku-eth/plugins';
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
/**
 * Options shared by both withdrawal modes. `tailCalls` comes from the higher-level
 * {@link UnshieldOptions} API; relayer mode does not execute them yet but is expected to.
 */
interface PPv1CommonUnshieldOptions extends UnshieldOptions {
  /** Gas budget for the execution phase when `tailCalls` are supplied. */
  tailCallsGasEstimate?: bigint;
  /**
   * Opt into exact-output mode: `amount` is read as the amount the recipient must
   * receive (net) and the gross is sized so the recipient gets exactly that after
   * fees. See {@link PPv1ExactUnshieldOptions}.
   *
   * With `mode: 'paymaster'` a `refundRecipient` is **required**: the paymaster refunds
   * the gas overcharge in postOp, so the caller must say where it goes. Point it at a
   * payer/change address and the recipient nets exactly `requestedNet`; point it at the
   * recipient and they receive *more* than requested (the resolved `expectedNet` is then
   * a lower bound).
   */
  exact?: PPv1ExactUnshieldOptions;
}

/** Relayer-mode withdrawal options. */
export interface PPv1RelayerUnshieldOptions extends PPv1CommonUnshieldOptions {
  mode?: 'relayer';
}

/** Paymaster-mode withdrawal options. The fields below only apply when the paymaster
 * sponsors the withdrawal. */
export interface PPv1PaymasterUnshieldOptions extends PPv1CommonUnshieldOptions {
  mode: 'paymaster';
  delegation?: DelegationConfig;
  /**
   * Where the paymaster sends the gas-overcharge refund in postOp (`fee - actualGasCost`).
   * Defaults to the withdrawal recipient. Set this to a payer/change address to keep the
   * refund away from the recipient — required for exact-output withdrawals (see `exact`).
   */
  refundRecipient?: AccountId;
  /** Consolidate multiple approved notes to reach the amount in one sponsored userOp. */
  batch?: boolean;
}

/**
 * Withdrawal options, discriminated on `mode`. Paymaster-only knobs (`delegation`,
 * `batch`, `refundRecipient`) live on {@link PPv1PaymasterUnshieldOptions} and are a type
 * error in relayer mode.
 */
export type PPv1UnshieldOptions = PPv1RelayerUnshieldOptions | PPv1PaymasterUnshieldOptions;

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

export interface PPv1EstimateUnshieldOptions {
  mode?: 'relayer' | 'paymaster';
  tailCalls?: UnshieldOptions['tailCalls'];
  tailCallsGasEstimate?: bigint;
}

/** Exact-output settings, passed as `prepareUnshield`'s `options.exact`. Its presence enables exact-output mode. */
export interface PPv1ExactUnshieldOptions {
  /**
   * Headroom added to the quote's gas component, as a percentage in basis points
   * where `10000` = 100% (so `1500` sizes the gas cost 15% higher). The recipient
   * always receives the exact requested output; this only raises the embedded fee
   * so the relayer still accepts the payload if gas ticks up between quote and
   * submission. Only the gas term is bumped — not the relayer's fixed base rate —
   * to avoid overpaying. The embedded fee is still capped at the asset's on-chain
   * `maxRelayFeeBPS`, and the withdrawal is rejected if the required fee exceeds
   * it. Ignored for paymaster withdrawals. Defaults to
   * {@link DEFAULT_EXACT_GAS_BUMP_BPS}.
   */
  gasBumpBPS?: bigint;
}

/** Resolved amounts for an exact-output unshield, attached to the returned operation as `exact`. */
export interface PPv1ExactUnshieldResult {
  /** Amount withdrawn from the pool (gross): the requested output plus fee and tip. */
  grossAmount: bigint;
  /** Requested recipient output (the `amount` passed in). */
  requestedNet: bigint;
  /** Amount the recipient will receive after fees. Equals `requestedNet` for the relayer path. */
  expectedNet: bigint;
  /** Fee deducted from the gross (relayer fee plus tip), in the pool asset's base units. */
  fee: bigint;
}

export interface PPv1PublicOperation extends PublicOperation {
  txns: TxData[];
}

export interface IEntrypoint {
  address: Address;
  deploymentBlock: bigint;
}

/**
 * Development-only tuning for Redux Toolkit's dev-mode safety checks. Both checks
 * are OFF by default (they are slow on large privacy-pool states); opt in per check
 * when you want the extra safety during development.
 */
export interface PPv1DevOptions {
  /** Enable the immutable-state-invariant middleware (off by default; slow on large states). */
  enableImmutableCheck?: boolean;
  /** Enable the serializable-state-invariant middleware (off by default). */
  enableSerializableCheck?: boolean;
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
  /**
   * Optional pre-built data service. Pass a saga-sync-backed one (see
   * `createSagaDataService`) to hydrate pool state without a full RPC log crawl.
   */
  dataService?: IDataService;
  /** Development-only Redux tuning. See {@link PPv1DevOptions}. */
  devOptions?: PPv1DevOptions;
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
  batch?: boolean;
  /** Gas-overcharge refund target (postOp). Defaults to `recipient`. */
  refundRecipient?: Address;
}

export interface IExactWithdrawalOperationParams extends Omit<IWithdrawapOperationParams, 'amount'> {
  /** Amount the recipient must receive after fees. */
  requestedNet: bigint;
  /** Headroom on the quote's gas component (bps, 10000 = 100%). See {@link PPv1ExactUnshieldOptions.gasBumpBPS}. */
  gasBumpBPS: bigint;
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

/** An exact-output withdrawal payload plus the resolved gross/net/fee it delivers. */
export type StateExactWithdrawalPayload = {
  payload: StateWithdrawalPayload;
  exact: PPv1ExactUnshieldResult;
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
   * Builds a relayer withdrawal whose recipient receives exactly `requestedNet`.
   * Sizes the gross against a fee tipped `tipBPS` above the live quote and embeds
   * that fee in self-built relay data (so the relayer accepts it without a matching
   * signed commitment). The returned payload carries no `feeCommitment`.
   */
  getExactWithdrawalPayloads: (params: IExactWithdrawalOperationParams) => Promise<StateExactWithdrawalPayload>;
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

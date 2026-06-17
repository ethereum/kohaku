import { PrivateOperation, PublicOperation } from '@kohaku-eth/plugins';

import { ISecretManager, SecretManagerParams } from "../../account/keys";
import { IDepositWithBalance } from "../../data/interfaces/events.interface";
import { IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { ProtocolConfigState } from "../../state";
import { SpecificAssetBalanceFn } from "../../state/selectors/balance.selector";
import { StoreFactoryParams } from "../../state/state-manager";
import { TornadoProveOutput } from "../../utils/tornado-prover.js";
import { TxData } from '@kohaku-eth/provider';
import { DepositStrategy } from '../../state/thunks/getDepositPayloadThunk';
import { PublicRootState } from '../../state/store';
import { IRelayerFeeConfig } from '../../state/slices/relayersSlice';
import { IGenericPaymasterWithdrawalPayload } from '../../relayer/interfaces/paymaster-client.interface';
import { Address } from '../../interfaces/types.interface';

export type DelegationConfig =
  | { mode: 'deterministic'; path?: string }
  | { mode: 'random' };

type StringAddress = `0x${string}`
export interface IPaymasterConfig {
  paymasterAddress: StringAddress;
  entryPointAddress: StringAddress;
  poolsAccountsMap: Record<StringAddress, StringAddress>;
  bundlerUrl: string;
}

export type IChainsPaymastersConfig = Record<number, IPaymasterConfig>;

export interface IRelayerWithdrawalPayload {
  mode: 'relayer';
  proof: TornadoProveOutput;
  poolAddress: Address;
  relayerUrl: string;
}

export type IWithdrawalPayload = IRelayerWithdrawalPayload | IGenericPaymasterWithdrawalPayload;

export interface TCPrivateOperation<Mode extends IWithdrawalPayload['mode'] = 'relayer' | 'paymaster'> extends PrivateOperation {
  withdrawals: (IWithdrawalPayload & {mode: Mode})[];
}

export interface TCPublicOperation extends PublicOperation {
  txns: TxData[];
}

export interface ITornadoArtifacts {
  circuitText: string;
  provingKey: ArrayBuffer;
}

export type TCProtocolConfig = Omit<ProtocolConfigState, 'chainId'>;

export interface TCProtocolParams {
  accountIndex?: number;
  paymasterConfig: IChainsPaymastersConfig;
  secretManagerFactory: (params: SecretManagerParams) => Promise<ISecretManager>;
  stateManager: (params: StoreFactoryParams) => Promise<IStateManager>;
  relayerClientFactory: () => IRelayerClient;
  protocolConfig: TCProtocolConfig;
  relayerConfig?: IRelayerFeeConfig;
  artifactsLoader?: () => Promise<ITornadoArtifacts>;
  initialState?: () => Promise<Record<string, PublicRootState>>;
  stateManagerWorkerUrl?: string;
}

interface IBaseOperationParams { }  // eslint-disable-line @typescript-eslint/no-empty-object-type

export interface IDepositOperationParams extends IBaseOperationParams {
  asset: Address;
  amount: bigint;
  strategy: DepositStrategy;
}

interface IWithdrawBaseParams extends Omit<IDepositOperationParams, 'amount' | 'strategy'> {
  amount?: bigint;
  recipient: Address;
}

export interface IRelayerWithdrawParams extends IWithdrawBaseParams {
  mode: 'relayer';
  preferredRelayersEns?: string[];
}

export interface IPaymasterWithdrawParams extends IWithdrawBaseParams {
  mode: 'paymaster';
  delegation?: DelegationConfig;
}

export type IWithdrawapOperationParams = IRelayerWithdrawParams | IPaymasterWithdrawParams;

export interface IRagequitAssetsOperationParams extends IBaseOperationParams {
  assets?: Address[];
}

export interface IGetNotesParams extends IBaseOperationParams {
  includeSpent?: boolean;
  assets?: Address[];
}

export type TCNote = Pick<
  IDepositWithBalance,
  'commitment' | 'balance' | 'assetAddress' | 'timestamp' | 'leafIndex' | 'pool'
> & {
  /** Fixed pool denomination for this note. */
  amount: bigint;
  depositIndex: number;
};

export type StoreKey = `${string}-${string}`;
export type StoreStorageKey = `tornado-cash-state-${StoreKey}`;

export interface IStateManager {
  /**
   * Queries the chain and updates its state
   */
  sync: () => Promise<void>;
  /**
   * Generates a deposit payload for the signer
   */
  getDepositPayload: (params: IDepositOperationParams) => Promise<TxData[]>;
  /**
   * Calls the relayer to submit withdrawals and returns job IDs
   */
  getWithdrawalPayloads: (params: IWithdrawapOperationParams) => Promise<IWithdrawalPayload[]>;
  /**
   * Gets the balance of the specified assets.
   * All assets if not specified.
   */
  getBalances: SpecificAssetBalanceFn<true>;
  /**
   * Gets all notes for the account.
   * @param includeSpent - If true, include notes with zero balance
   * @param assets - Optional filter by specific assets
   */
  getNotes: (params: IGetNotesParams) => Promise<TCNote[]>;
  dumpState: () => Record<StoreStorageKey, PublicRootState>;
}

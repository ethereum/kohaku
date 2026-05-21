import { PrivateOperation, PublicOperation } from '@kohaku-eth/plugins';
import type { SignedAuthorization } from 'viem';

import { ISecretManager, SecretManagerParams } from "../../account/keys";
import { Address } from "../../interfaces/types.interface";
import { IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { ProtocolConfigState } from "../../state";
import { SpecificAssetBalanceFn } from "../../state/selectors/balance.selector";
import { StoreFactoryParams } from "../../state/state-manager";
import { TornadoProveOutput } from "../../utils/tornado-prover";
import { ITornadoProver } from "../../utils/tornado-prover";
import { TxData } from '@kohaku-eth/provider';
import { DepositStrategy } from '../../state/thunks/getDepositPayloadThunk';
import { PublicRootState } from '../../state/store';
import { IRelayerFeeConfig } from '../../state/slices/relayersSlice';

export type DelegationConfig =
  | { mode: 'deterministic'; path?: string }
  | { mode: 'random' };

export interface IPaymasterConfig {
  paymasterAddress: `0x${string}`;
  accountAddress: `0x${string}`;
  bundlerUrl: string;
  entryPointAddress: `0x${string}`;
  delegation?: DelegationConfig;
}

export interface SignedDelegation {
  senderAddress: `0x${string}`;
  authorization: SignedAuthorization;
}

export interface IRelayerWithdrawalPayload {
  mode: 'relayer';
  proof: TornadoProveOutput;
  poolAddress: Address;
  relayerUrl: string;
}

export interface IPaymasterWithdrawalPayload {
  mode: 'paymaster';
  proof: TornadoProveOutput;
  poolAddress: Address;
  paymasterAddress: `0x${string}`;
  entryPointAddress: `0x${string}`;
  bundlerUrl: string;
  accountAddress: `0x${string}`;
  delegation?: SignedDelegation;
}

export type IWithdrawalPayload = IRelayerWithdrawalPayload | IPaymasterWithdrawalPayload;

export interface TCPrivateOperation<Mode extends IWithdrawalPayload['mode'] = 'relayer' | 'paymaster'> extends PrivateOperation {
  withdrawals: (IWithdrawalPayload & {mode: Mode})[];
}

export interface TCPublicOperation extends PublicOperation {
  txns: TxData[];
}

export interface ITornadoArtifacts {
  circuitUrl: string;
  provingKeyUrl: string;
}

export type TCProtocolConfig = Omit<ProtocolConfigState, 'chainId'>;

export interface PrivacyPoolsV1ProtocolParams {
  accountIndex?: number;
  secretManagerFactory: (params: SecretManagerParams) => Promise<ISecretManager>;
  stateManager: (params: StoreFactoryParams) => Promise<IStateManager>;
  relayerClientFactory: () => IRelayerClient;
  protocolConfig: TCProtocolConfig;
  relayerConfig?: IRelayerFeeConfig;
  artifacts: ITornadoArtifacts;
  proverFactory?: () => Promise<ITornadoProver>;
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
  paymasterConfig: IPaymasterConfig;
}

export type IWithdrawapOperationParams = IRelayerWithdrawParams | IPaymasterWithdrawParams;

export interface IRagequitAssetsOperationParams extends IBaseOperationParams {
  assets?: Address[];
}

export interface IGetNotesParams extends IBaseOperationParams {
  includeSpent?: boolean;
  assets?: Address[];
}

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
  dumpState: () => Record<StoreStorageKey, PublicRootState>;
}

import { PrivateOperation, PublicOperation } from '@kohaku-eth/plugins';

import { ISecretManager, SecretManagerParams } from "../../account/keys";
import { Address } from "../../interfaces/types.interface";
import { IRelayerClient } from '../../relayer/interfaces/relayer-client.interface';
import { RootState } from "../../state";
import { SpecificAssetBalanceFn } from "../../state/selectors/balance.selector";
import { StoreFactoryParams } from "../../state/state-manager";
import { TornadoProveOutput } from "../../utils/tornado-prover";
import { ITornadoProver } from "../../utils/tornado-prover";
import { TxData } from '@kohaku-eth/provider';

export interface IWithdrawalPayload {
  proof: TornadoProveOutput;
  poolAddress: Address;
  relayerUrl: string;
};

export interface TCPrivateOperation extends PrivateOperation {
  withdrawals: IWithdrawalPayload[];
}

export interface TCPublicOperation extends PublicOperation {
  txns: TxData[];
}

export interface IInstanceRegistry {
  address: Address;
  deploymentBlock: bigint;
  relayerRegistry: {
    address: Address;
    deploymentBlock: bigint;
    aggregatorAddress: Address;
    ensSubdomainKey: string;
    feeConfig?: {
      minFee: number;
      maxFee: number;
    };
  };
}

export interface ITornadoArtifacts {
  wasmUrl: string;
  zkeyUrl: string;
}

export interface PrivacyPoolsV1ProtocolParams {
  accountIndex?: number;
  secretManagerFactory: (params: SecretManagerParams) => Promise<ISecretManager>;
  stateManager: (params: StoreFactoryParams) => Promise<IStateManager>;
  relayerClientFactory: () => IRelayerClient;
  instanceRegistry: IInstanceRegistry;
  artifacts: ITornadoArtifacts;
  proverFactory?: () => Promise<ITornadoProver>;
  initialState?: Record<string, RootState>;
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

export interface IGetNotesParams extends IBaseOperationParams {
  includeSpent?: boolean;
  assets?: Address[];
}

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
  dumpState: () => Record<StoreStorageKey, RootState>;
}

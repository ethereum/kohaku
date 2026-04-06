/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import {
  AccountId,
  AssetAmount,
  ERC20AssetId,
  Host,
} from "@kohaku-eth/plugins";

import { SecretManager } from "../account/keys";
import { DataService } from "../data/data.service";
import { IRelayerClient } from "../relayer/interfaces/relayer-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { storeStateManager } from "../state/state-manager";
import { addressToHex, } from "../utils.js";
import { encodeWithdrawalPayload } from "../utils/encoding.utils.js";
import {
  PPv1AssetAmount,
  PPv1AssetBalance,
  PPv1BroadcasterParameters,
  PPv1Instance,
} from "../v1/interfaces.js";
import {
  IInstanceRegistry,
  INote,
  IStateManager,
  PPv1PrivateOperation,
  PPv1PublicOperation,
  PrivacyPoolsV1ProtocolParams,
} from "./interfaces/protocol-params.interface";
import { toHex } from "viem";

type RequireOnly<T, Keys extends keyof T> = Partial<T> & Pick<T, Keys>;

export interface PPv1RelayerConstructorParams extends PPv1BroadcasterParameters {
  relayerClientFactory?: () => IRelayerClient;
  host: Host;
}

export class PrivacyPoolsV1Protocol implements PPv1Instance {
  private stateManager: Promise<IStateManager>;
  private instanceRegistry: IInstanceRegistry;
  private relayerClient: IRelayerClient;

  constructor(
    readonly host: Host,
    {
      accountIndex = 0,
      initialState = {},
      secretManagerFactory = SecretManager,
      stateManager: stateManagerFactory = storeStateManager,
      instanceRegistry,
      relayerClientFactory = () => new RelayerClient({ network: host.network }),
      proverFactory = Prover,
    }: RequireOnly<PrivacyPoolsV1ProtocolParams, 'instanceRegistry'>,
  ) {
    this.instanceRegistry = instanceRegistry;
    this.relayerClient = relayerClientFactory();
    this.stateManager = stateManagerFactory({
      initialState: { ...initialState },
      secretManagerFactory: () => secretManagerFactory({ accountIndex, host }),
      dataService: new DataService({ provider: host.provider }),
      relayerClient: this.relayerClient,
      proverFactory,
      storageToSyncTo: host.storage,
      instanceRegistry,
    });
  }

  instanceId = () => Promise.resolve("0x1" as const);

  /**
   * Only process supported assets or error out?
   * Returns the balances of the requested assets.
   * The assets retain the provided order. If an asset is not supported its balance will be 0
   */
  async balance(assets: ERC20AssetId[] = []): Promise<PPv1AssetBalance[]> {
    const stateManager = await this.stateManager;

    await stateManager.sync();
    const parsedDesiredAssets = assets.map(({ contract }) => BigInt(contract));

    const balances = await stateManager.getBalances(
      assets.length > 0 ? parsedDesiredAssets : undefined,
    );
    
    const actuallySelectedAssets = assets.length > 0 ? assets.map((a) => a.contract) : [...balances.keys()].map((a) => addressToHex(a))

    return actuallySelectedAssets.map((assetAddress, index) => {
      const balance = balances.get(BigInt(actuallySelectedAssets[index]!)) || 0n;

      const asset: ERC20AssetId = {
        contract: assetAddress,
        __type: 'erc20'
      }; 

      return {
        asset,
        amount: balance,
      };
    });
  }

  async prepareShield(
    assets: PPv1AssetAmount,
  ): Promise<PPv1PublicOperation> {
    const { asset, amount } = assets;
    const stateManager = await this.stateManager;

    await stateManager.sync();

    const tx = await stateManager.getDepositPayload({
      asset: BigInt(asset.contract),
      amount,
    });

    return { txns: tx } as PPv1PublicOperation;
  }

  /**
   * Returns all notes for the account.
   * @param assets - Filter by specific assets (optional, if empty returns all chains)
   * @param includeSpent - Include notes with zero balance (default: false)
   */
  async notes(
    assets: ERC20AssetId[] = [],
    includeSpent = false,
  ): Promise<INote[]> {
    const stateManager = await this.stateManager;

    await stateManager.sync();

    const assetsAddresses = assets.map(({ contract }) => BigInt(contract));

    return stateManager.getNotes({
      includeSpent,
      assets: assetsAddresses.length > 0 ? assetsAddresses : undefined,
    });
  }

  async prepareUnshield(assets: AssetAmount, to: AccountId): Promise<PPv1PrivateOperation> {
    const { asset, amount } = assets;
    const instanceRegistry = this.instanceRegistry;
    const assetAddress = BigInt(asset.contract);
    const stateManager = await this.stateManager;

    await stateManager.sync();

    const [result] = await stateManager.getWithdrawalPayloads({
      asset: assetAddress,
      amount,
      recipient: BigInt(to),
    });

    if (!result) throw new Error("We failed to create a withdrawalPayload");

    const {
      proofResult,
      quoteData,
      withdrawalInfo: { scope, relayDataObject, context, withdrawalObject },
      chainId,
    } = result;

    const rawData = {
      context,
      relayData: relayDataObject,
      proof: proofResult,
      withdrawalPayload: withdrawalObject,
      chainId,
      scope,
    };

    const encodedWithdrawalData = encodeWithdrawalPayload(
      withdrawalObject,
      proofResult,
      scope,
    );

    return {
      rawData,
      txData: {
        to: toHex(instanceRegistry.address, { size: 20 }),
        data: encodedWithdrawalData,
        value: 0n,
      },
      quoteData,
    } as PPv1PrivateOperation;
  }

  async sync() {
    const stateManager = await this.stateManager;

    return stateManager.sync();
  }

  async dumpState() {
    const stateManager = await this.stateManager;

    return stateManager.dumpState();
  }
}

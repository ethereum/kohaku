 
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
import {
  TCAssetAmount,
  TCAssetBalance,
  TCInstance,
} from "../v1/interfaces.js";
import { BUNDLED_WASM_URL, BUNDLED_ZKEY_URL, downloadArtifactsAndCreateProver } from "../utils/tornado-prover";
import {
  IStateManager,
  TCPrivateOperation,
  TCPublicOperation,
  PrivacyPoolsV1ProtocolParams,
} from "./interfaces/protocol-params.interface";
import { E_ADDRESS_BIGINT } from "../config";

type RequireOnly<T, Keys extends keyof T> = Partial<T> & Pick<T, Keys>;

export class TornadoCashProtocol implements TCInstance {
  private stateManager: Promise<IStateManager>;
  private relayerClient: IRelayerClient;

  constructor(
    readonly host: Host,
    {
      accountIndex = 0,
      initialState = {},
      secretManagerFactory = SecretManager,
      stateManager: stateManagerFactory = storeStateManager,
      instanceRegistry,
      artifacts = { wasmUrl: BUNDLED_WASM_URL, zkeyUrl: BUNDLED_ZKEY_URL },
      relayerClientFactory = () => new RelayerClient({ network: host.network }),
      proverFactory = () => downloadArtifactsAndCreateProver(host, artifacts.wasmUrl, artifacts.zkeyUrl),
    }: RequireOnly<PrivacyPoolsV1ProtocolParams, 'instanceRegistry'>,
  ) {
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
  async balance(assets: ERC20AssetId[] = []): Promise<TCAssetBalance[]> {
    const stateManager = await this.stateManager;

    await stateManager.sync();
    const parsedDesiredAssets = assets.map(({ contract }) => {
      const parsedAddress = BigInt(contract);

      return parsedAddress === E_ADDRESS_BIGINT ? 0n : parsedAddress;
    });

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
    assets: TCAssetAmount,
  ): Promise<TCPublicOperation> {
    const { asset, amount } = assets;
    const stateManager = await this.stateManager;

    await stateManager.sync();

    const parsedAsset = BigInt(asset.contract);

    const tx = await stateManager.getDepositPayload({
      asset: parsedAsset === E_ADDRESS_BIGINT ? 0n : parsedAsset,
      amount,
    });

    return { txns: tx } as TCPublicOperation;
  }

  async prepareUnshield(assets: AssetAmount, to: AccountId): Promise<TCPrivateOperation> {
    const { asset, amount } = assets;
    const parsedAsset = BigInt(asset.contract);
    const stateManager = await this.stateManager;

    await stateManager.sync();

    const withdrawals = await stateManager.getWithdrawalPayloads({
      asset: parsedAsset === E_ADDRESS_BIGINT ? 0n : parsedAsset,
      amount,
      recipient: BigInt(to),
    });

    return {
      __type: 'privateOperation',
      withdrawals
    }as TCPrivateOperation;
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

import {
  AccountId,
  AssetAmount,
  ERC20AssetId,
  Host,
} from "@kohaku-eth/plugins";
import { wrap, proxy, transfer } from 'comlink';

import { addressToHex, } from "../utils.js";
import {
  TCAssetAmount,
  TCAssetBalance,
  TCInstance,
} from "../v1/interfaces.js";
import {
  IStateManager,
  TCPrivateOperation,
  TCPublicOperation,
  PrivacyPoolsV1ProtocolParams,
} from "./interfaces/protocol-params.interface";
import { E_ADDRESS_BIGINT } from "../config";
import type { WorkerApi } from '../state/state-manager.worker';

type RequireOnly<T, Keys extends keyof T> = Partial<T> & Pick<T, Keys>;

export class TornadoCashProtocol implements TCInstance {
  private stateManager: Promise<IStateManager>;

  constructor(
    readonly host: Host,
    {
      accountIndex = 0,
      initialState = async () => ({}),
      instanceRegistry,
      artifacts,
    }: RequireOnly<PrivacyPoolsV1ProtocolParams, 'instanceRegistry' | 'artifacts'>,
  ) {
    this.stateManager = (async () => {
      const [state, wasmRes, zkeyRes] = await Promise.all([
        initialState(),
        host.network.fetch(artifacts.wasmUrl),
        host.network.fetch(artifacts.zkeyUrl),
      ]);
      const [proverWasm, proverZkey] = await Promise.all([
        wasmRes.arrayBuffer(),
        zkeyRes.arrayBuffer(),
      ]);

      const worker = new Worker('./state-manager.worker.js', { type: 'module' });

      const workerReady = new Promise<void>((_resolve, reject) => {
        worker.addEventListener('error', (e) => {
          console.error('[worker crash]', { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno, error: e.error });
          reject(e.error ?? new Error(e.message));
        });
      });

      const remote = wrap<WorkerApi>(worker);

      await Promise.race([
        remote.init(
          proxy(host.provider),
          proxy(host.network),
          proxy(host.keystore),
          proxy(host.storage),
          instanceRegistry,
          accountIndex,
          state,
          transfer(proverWasm, [proverWasm]),
          transfer(proverZkey, [proverZkey]),
        ),
        workerReady,
      ]);

      return {
        sync: () => remote.sync(),
        getBalances: ((assets: bigint[] | undefined) => remote.getBalances(assets)) as unknown as IStateManager['getBalances'],
        getDepositPayload: (params) => remote.getDepositPayload(params),
        getWithdrawalPayloads: (params) => remote.getWithdrawalPayloads(params),
        dumpState: (() => remote.dumpState()) as unknown as IStateManager['dumpState'],
      } as IStateManager;
    })();
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
      const parsedSelectedAsset = BigInt(actuallySelectedAssets[index]!);
      const balance = balances.get(parsedSelectedAsset === E_ADDRESS_BIGINT ? 0n : parsedSelectedAsset) || 0n;

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

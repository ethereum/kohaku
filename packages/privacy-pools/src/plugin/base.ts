/* eslint-disable max-lines */
import { Prover } from "@fatsolutions/privacy-pools-core-circuits";
import {
  AccountId,
  AssetAmount,
  ERC20AssetId,
  Host,
} from "@kohaku-eth/plugins";

import { ISecretManager, SecretManager } from "../account/keys";
import { PrivacyPoolsPaymasterConfigs } from "../config.js";
import { IPFSAspService } from "../data/ipfsAsp.service.js";
import { DataService } from "../data/data.service";
import { IPaymasterBroadcasterClient } from "../relayer/interfaces/paymaster-client.interface";
import { IRelayerClient } from "../relayer/interfaces/relayer-client.interface";
import { RelayerClient } from "../relayer/relayer-client";
import { storeStateManager } from "../state/state-manager";
import { addressToHex, } from "../utils.js";
import { encodeRagequitPayload, encodeWithdrawalPayload } from "../utils/encoding.utils.js";
import { deductFeeBPS } from "../utils/fee.utils.js";
import {
  PPv1AssetAmount,
  PPv1AssetBalance,
  PPv1BroadcasterParameters,
  PPv1Instance,
} from "../v1/interfaces.js";
import {
  IEntrypoint,
  INote,
  IStateManager,
  PPv1EstimateUnshieldOptions,
  PPv1PaymasterPrivateOperation,
  PPv1PrivateOperation,
  PPv1PublicOperation,
  PPv1RelayerPrivateOperation,
  PPv1ShieldEstimate,
  PPv1UnshieldEstimate,
  PPv1UnshieldOptions,
  PrivacyPoolsV1ProtocolParams,
  StateWithdrawalPayload,
} from "./interfaces/protocol-params.interface";
import { TxData } from "@kohaku-eth/provider";

type RequireOnly<T, Keys extends keyof T> = Partial<T> & Pick<T, Keys>;

export interface PPv1RelayerConstructorParams extends PPv1BroadcasterParameters {
  relayerClientFactory?: () => IRelayerClient;
  paymasterClientFactory?: () => IPaymasterBroadcasterClient;
  host: Host;
}

/** Default gas headroom for exact-output unshields: 15% over the quote's gas component (bps, 10000 = 100%). */
export const DEFAULT_EXACT_GAS_BUMP_BPS = 1_500n;

/** Thrown when an exact-output unshield's built operation would leave the recipient below the requested output. */
export class PPv1ExactOutputError extends Error {
  constructor(
    readonly requestedNet: bigint,
    readonly expectedNet: bigint,
  ) {
    super(
      `Exact-output unshield short by ${requestedNet - expectedNet} ` +
        `(requested ${requestedNet}, would deliver ${expectedNet})`,
    );
    this.name = "PPv1ExactOutputError";
  }
}

/** Reads the fee actually committed in a built withdrawal and the net it delivers for a given gross. */
function resolveExactOutput(
  operation: PPv1PrivateOperation,
  grossAmount: bigint,
): { expectedNet: bigint; fee: bigint; } {
  if (operation.mode === 'paymaster') {
    const { fee } = operation.withdrawal;

    return { fee, expectedNet: grossAmount - fee };
  }

  // The relayer signs the fee into its withdrawal data; the on-chain deduction
  // floors it, matching `deductFeeBPS`.
  const { fee, net } = deductFeeBPS(grossAmount, operation.rawData.relayData.relayFeeBps);

  return { fee, expectedNet: net };
}

export class PrivacyPoolsV1Protocol implements PPv1Instance {
  private accountIndex: number;
  private secretManager: ISecretManager;
  private stateManager: IStateManager;
  private entrypoint: IEntrypoint;
  private relayersList: Map<string, string>;
  private relayerClient: IRelayerClient;

  constructor(
    readonly host: Host,
    {
      accountIndex = 0,
      initialState,
      secretManager = SecretManager,
      stateManager: stateManagerFactory = storeStateManager,
      entrypoint,
      relayersList = {},
      ipfsUrl,
      aspServiceFactory = () => new IPFSAspService({ network: host.network, ipfsUrl }),
      relayerClientFactory = () => new RelayerClient({ network: host.network }),
      proverFactory = Prover,
      paymasterConfig = PrivacyPoolsPaymasterConfigs,
      dataService = new DataService({ provider: host.provider }),
      devOptions,
    }: RequireOnly<PrivacyPoolsV1ProtocolParams, "entrypoint">,
  ) {
    this.accountIndex = accountIndex;
    this.entrypoint = entrypoint;
    this.relayersList = new Map(Object.entries(relayersList));
    this.relayerClient = relayerClientFactory();
    this.secretManager = secretManager({
      host,
      accountIndex: this.accountIndex,
    });
    this.stateManager = stateManagerFactory({
      initialState,
      secretManager: this.secretManager,
      aspService: aspServiceFactory(),
      dataService,
      relayerClient: this.relayerClient,
      relayersList: this.relayersList,
      proverFactory,
      storageToSyncTo: host.storage,
      entrypoint,
      paymasterConfig,
      devOptions,
    });
  }

  instanceId = () => Promise.resolve("0x1" as const);

  /**
   * Only process supported assets or error out?
   * Returns the balances of the requested assets.
   * The assets retain the provided order. If an asset is not supported its balance will be 0
   */
  async balance(assets: ERC20AssetId[] = []): Promise<PPv1AssetBalance[]> {
    await this.stateManager.sync();
    const parsedDesiredAssets = assets.map(({ contract }) => BigInt(contract));

    const balances = await this.stateManager.getBalances(
      assets.length > 0 ? parsedDesiredAssets : undefined,
      "both",
    );

    const actuallySelectedAssets = assets.length > 0 ? assets.map((a) => a.contract) : [...balances.keys()].map((a) => addressToHex(a))

    return actuallySelectedAssets.map((assetAddress, index) => {
      const { approved, unapproved } = balances.get(BigInt(actuallySelectedAssets[index]!)) || {
        approved: 0n,
        unapproved: 0n
      };

      const asset: ERC20AssetId = {
        contract: assetAddress,
        __type: 'erc20'
      };

      return [{
        asset,
        amount: approved,
      }, {
        asset,
        amount: unapproved,
        tag: 'pending' as const
      }];
    }).flat();
  }

  async prepareShield(
    assets: PPv1AssetAmount,
  ): Promise<PPv1PublicOperation> {
    const { asset, amount } = assets;

    await this.stateManager.sync();

    const tx = await this.stateManager.getDepositPayload({
      asset: BigInt(asset.contract),
      amount,
    });

    return { txns: [tx] } as PPv1PublicOperation;
  }

  /**
   * Returns the vetting fee and credited amount for a deposit, read from the
   * Entrypoint's current asset config. Network gas is not included.
   */
  async estimateShield({ asset, amount }: PPv1AssetAmount): Promise<PPv1ShieldEstimate> {
    return this.stateManager.getShieldEstimate({
      asset: BigInt(asset.contract),
      amount,
    });
  }

  /**
   * Returns the withdrawal fee and the amount the recipient receives for the
   * given mode, without generating a proof. Cheap enough to call while a form is
   * being edited; `prepareUnshield` fetches its own quote when submitting.
   */
  async estimateUnshield(
    { asset, amount }: AssetAmount,
    to: AccountId,
    options?: PPv1EstimateUnshieldOptions,
  ): Promise<PPv1UnshieldEstimate> {
    if (asset.__type === 'native') {
      throw new Error("Unshielding native assets is not supported in this version of the protocol");
    }

    return this.stateManager.getUnshieldEstimate({
      asset: BigInt(asset.contract),
      amount,
      recipient: BigInt(to),
      mode: options?.mode,
      hasTailCalls: !!options?.tailCalls,
      tailCallsGasEstimate: options?.tailCallsGasEstimate,
    });
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
    await this.stateManager.sync();

    const assetsAddresses = assets.map(({ contract }) => BigInt(contract));

    return this.stateManager.getNotes({
      includeSpent,
      assets: assetsAddresses.length > 0 ? assetsAddresses : undefined,
    });
  }

  async ragequit(
    labels: INote['label'][]
  ) {
    await this.stateManager.sync();

    const ragequitRawPayloads = await this.stateManager.getRagequitByLabelPayloads({
      labels,
    });

    const ragequitTxs: TxData[] = ragequitRawPayloads.map(({ proofResult, poolAddress }) => {
      return {
        to: addressToHex(poolAddress),
        data: encodeRagequitPayload(proofResult),
        value: 0n
      };
    });

    return { txns: ragequitTxs } as PPv1PublicOperation;
  }

  /**
   * Prepares a withdrawal. By default `assets.amount` is the gross withdrawn from
   * the pool and the recipient receives it minus the relayer/paymaster fee.
   *
   * Passing `options.exact` switches to exact-output mode: `assets.amount` is read
   * as the amount the recipient must *receive*. For relayer withdrawals the gross is
   * sized so the recipient gets exactly that after fees, with the embedded fee tipped
   * `options.exact.tipBPS` above the live quote so the relayer still accepts the
   * payload if its rate rises before submission (the sender pays the tip on top). For
   * paymaster withdrawals the gross is sized from the gas estimate and the built
   * operation is re-checked, throwing {@link PPv1ExactOutputError} if it would fall
   * short. On success the resolved gross/net/fee are attached as `operation.exact`.
   */
  async prepareUnshield(assets: AssetAmount, to: AccountId, options?: PPv1UnshieldOptions): Promise<PPv1PrivateOperation> {
    if (options?.exact) {
      return this.prepareExactUnshield(assets, to, options);
    }

    return this.buildUnshield(assets, assets.amount, to, options);
  }

  private async prepareExactUnshield(
    assets: AssetAmount,
    to: AccountId,
    options: PPv1UnshieldOptions,
  ): Promise<PPv1PrivateOperation> {
    const requestedNet = assets.amount;

    if (requestedNet <= 0n) {
      throw new Error("Requested output must be greater than zero");
    }

    if (options.mode === 'paymaster') {
      return this.prepareExactPaymasterUnshield(assets, to, options, requestedNet);
    }

    return this.prepareExactRelayerUnshield(assets, to, options, requestedNet);
  }

  private async prepareExactRelayerUnshield(
    assets: AssetAmount,
    to: AccountId,
    options: PPv1UnshieldOptions,
    requestedNet: bigint,
  ): Promise<PPv1PrivateOperation> {
    await this.stateManager.sync();

    const { payload, exact } = await this.stateManager.getExactWithdrawalPayloads({
      asset: this.unshieldAssetAddress(assets),
      recipient: BigInt(to),
      requestedNet,
      gasBumpBPS: options.exact?.gasBumpBPS ?? DEFAULT_EXACT_GAS_BUMP_BPS,
    });

    // The recipient's net is fixed by the gross and embedded fee we chose, so it must
    // equal the request exactly; guard the invariant defensively.
    if (exact.expectedNet !== requestedNet) {
      throw new PPv1ExactOutputError(requestedNet, exact.expectedNet);
    }

    const operation = this.assembleRelayerOperation(payload);

    operation.exact = exact;

    return operation;
  }

  private async prepareExactPaymasterUnshield(
    assets: AssetAmount,
    to: AccountId,
    options: PPv1UnshieldOptions,
    requestedNet: bigint,
  ): Promise<PPv1PrivateOperation> {
    const estimate = await this.estimateUnshield(assets, to, options);
    const grossAmount = requestedNet + estimate.fee;
    const operation = await this.buildUnshield(assets, grossAmount, to, options);
    const { expectedNet, fee } = resolveExactOutput(operation, grossAmount);

    if (expectedNet < requestedNet) {
      throw new PPv1ExactOutputError(requestedNet, expectedNet);
    }

    operation.exact = { grossAmount, requestedNet, expectedNet, fee };

    return operation;
  }

  private unshieldAssetAddress(assets: AssetAmount): bigint {
    if (assets.asset.__type === 'native') {
      throw new Error("Unshielding native assets is not supported in this version of the protocol");
    }

    return BigInt(assets.asset.contract);
  }

  private async buildUnshield(
    assets: AssetAmount,
    amount: bigint,
    to: AccountId,
    options?: PPv1UnshieldOptions,
  ): Promise<PPv1PrivateOperation> {
    const assetAddress = this.unshieldAssetAddress(assets);

    await this.stateManager.sync();

    if (options?.mode === 'paymaster') {
      const [withdrawal] = await this.stateManager.getPaymasterWithdrawalPayloads({
        asset: assetAddress,
        amount,
        recipient: BigInt(to),
        delegation: options.delegation,
        tailCalls: options.tailCalls,
        tailCallsGasEstimate: options.tailCallsGasEstimate,
      });

      if (!withdrawal) throw new Error("We failed to create a paymaster withdrawalPayload");

      return { mode: 'paymaster', withdrawal } as PPv1PaymasterPrivateOperation;
    }

    const [result] = await this.stateManager.getWithdrawalPayloads({
      asset: assetAddress,
      amount,
      recipient: BigInt(to),
    });

    if (!result) throw new Error("We failed to create a withdrawalPayload");

    return this.assembleRelayerOperation(result);
  }

  /** Assembles a relayer private operation (rawData + entrypoint tx) from a built withdrawal payload. */
  private assembleRelayerOperation(result: StateWithdrawalPayload): PPv1RelayerPrivateOperation {
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
      mode: 'relayer',
      rawData,
      txData: {
        to: `0x${this.entrypoint.address.toString(16).padStart(40, "0")}`,
        data: encodedWithdrawalData,
        value: 0n,
      },
      quoteData,
    } as PPv1RelayerPrivateOperation;
  }

  sync() {
    return this.stateManager.sync();
  }

  dumpState() {
    return this.stateManager.dumpState();
  }
}

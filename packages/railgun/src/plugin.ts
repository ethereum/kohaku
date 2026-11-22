import type {
  AssetAmount, AssetId, Host, PluginInstance, UnshieldOptions as PluginUnshieldOptions,
} from "@kohaku-eth/plugins";
import { InvalidAddressError, scopeKeystore, UnsupportedAssetError, UnsupportedChainError } from "@kohaku-eth/plugins";
import type { TxData } from "@kohaku-eth/provider";
import type {
  Hex, PoiProcessReport, PreparedUserOperation, RailgunAddress, RailgunNote,
  PoiStatus, ShieldEntry,
} from "./types.js";
import { RailgunWorkerWallet } from "./worker-wallet.js";
import { railgunKeyPaths } from "./wallet.js";
import { createCheckpointCipher, type CheckpointCipher } from "./checkpoint-crypto.js";

export type RailgunAssetId = AssetId;
export type RailgunAssetAmount = AssetAmount<AssetId, bigint>;
export type RailgunAssetBalance = AssetAmount<RailgunAssetId, bigint> & { poiStatus: PoiStatus | null };
export type RailgunPublicOperation = { __type: "publicOperation"; txns: TxData[] };
export type RailgunPrivateOperation = {
  __type: "privateOperation";
  mode: "userop";
  prepared: PreparedUserOperation;
  bundlerUrl: string;
  chainId: bigint;
};

export interface RailgunPluginOptions {
  /** HTTP(S) RPC endpoint for the current Railgun deployment. */
  rpcUrl: string;
  /** ERC-4337 bundler endpoint, including eth_estimateUserOperationGas state overrides. */
  bundlerUrl: string;
  /** Host keystore path of the EOA authorized to sign the EIP-7702 UserOperation. */
  accountSigningPath: string;
  /** Railgun spending/viewing key index. Both paths use the engine-compatible hash chain. */
  accountIndex?: number;
  artifactBaseUrl?: string;
}

export interface RailgunTransferOptions { memo?: string }
export interface RailgunUnshieldOptions {
  /** Ordered calls after the unshield and optional wrapped-native withdrawal. */
  tailCalls?: PluginUnshieldOptions["tailCalls"] | readonly { target: Hex; value: bigint; data: Hex }[];
}

export type RailgunInstance = PluginInstance<
  RailgunAddress,
  {
    features: {
      prepareShield: true;
      prepareShieldMulti: true;
      prepareTransfer: true;
      prepareUnshield: true;
    };
    assetAmounts: {
      input: RailgunAssetAmount;
      internal: RailgunAssetAmount;
      output: RailgunAssetAmount;
      read: RailgunAssetBalance;
    };
    note: RailgunNote;
    publicOp: RailgunPublicOperation;
    privateOp: RailgunPrivateOperation;
    extras: {
      sync(): Promise<void>;
      syncTo(block: bigint): Promise<void>;
      syncHistoryTo(block: bigint): Promise<void>;
      refreshPoi(): Promise<void>;
      processPendingPoi(): Promise<PoiProcessReport>;
      prepareTransfer(asset: RailgunAssetAmount, to: RailgunAddress, options?: RailgunTransferOptions): Promise<RailgunPrivateOperation>;
      prepareUnshield(asset: RailgunAssetAmount, to: Hex, options?: RailgunUnshieldOptions): Promise<RailgunPrivateOperation>;
    };
  }
>;

const ERC20 = /^erc20:(0x[0-9a-fA-F]{40})$/i;
const ERC721 = /^erc721:(0x[0-9a-fA-F]{40})\/(\d+)$/i;
const ERC1155 = /^erc1155:(0x[0-9a-fA-F]{40})\/(\d+)$/i;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const USDT_MAINNET = "0xdac17f958d2ee523a2206206994597c13d831ec7";

function parseAsset(text: string): RailgunAssetId {
  const erc20 = ERC20.exec(text);
  if (erc20) return { __type: "erc20", contract: erc20[1] as Hex };
  const erc721 = ERC721.exec(text);
  if (erc721) return { __type: "erc721", contract: erc721[1] as Hex, tokenId: BigInt(erc721[2]!) };
  const erc1155 = ERC1155.exec(text);
  if (erc1155) return { __type: "erc1155", contract: erc1155[1] as Hex, tokenId: BigInt(erc1155[2]!) };
  throw new Error(`Unsupported Railgun asset ID: ${text}`);
}

function assetKey(asset: RailgunAssetId, wrappedBaseToken: Hex): string {
  if (asset.__type === "native") return `erc20:${wrappedBaseToken.toLowerCase()}`;
  if (!ADDRESS.test(asset.contract)) throw new InvalidAddressError(asset.contract);
  return asset.__type === "erc20"
    ? `erc20:${asset.contract.toLowerCase()}`
    : `${asset.__type}:${asset.contract.toLowerCase()}/${asset.tokenId}`;
}

function spendToken(asset: RailgunAssetId, wrappedBaseToken: Hex): Hex {
  if (asset.__type === "native") return wrappedBaseToken;
  if (asset.__type !== "erc20") throw new UnsupportedAssetError(asset as AssetId);
  if (!ADDRESS.test(asset.contract)) throw new InvalidAddressError(asset.contract);
  return asset.contract;
}

function approve(token: Hex, spender: Hex, amount: bigint): TxData {
  if (amount < 0n || amount >= 1n << 256n) throw new RangeError("ERC-20 approval amount is out of range");
  return {
    to: token,
    data: `0x095ea7b3${spender.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`,
    value: 0n,
  };
}

/** PPOI-aware Railgun plugin backed by the current kohaku-rs WASM wallet. */
export class RailgunProtocol implements RailgunInstance {
  private constructor(
    readonly host: Host,
    private readonly wallet: RailgunWorkerWallet,
    private readonly accountSigningPath: string,
    private readonly bundlerUrl: string,
    private readonly chainId: bigint,
  ) {}

  static async open(host: Host, options: RailgunPluginOptions): Promise<RailgunProtocol> {
    if (!options.rpcUrl || !options.bundlerUrl || !options.accountSigningPath) {
      throw new Error("Railgun requires rpcUrl, bundlerUrl, and accountSigningPath");
    }
    const chainId = await host.provider.getChainId();
    const accountIndex = options.accountIndex ?? 0;
    const paths = railgunKeyPaths(accountIndex);
    const keystore = scopeKeystore(host.keystore, { prefixes: [], paths: [paths.spending, paths.viewing, options.accountSigningPath] });
    const [spendingKey, viewingKey] = await Promise.all([
      keystore.deriveAt(paths.spending), keystore.deriveAt(paths.viewing),
    ]);

    let storageKey: string | undefined;
    let cipher: CheckpointCipher | undefined;
    const wallet = RailgunWorkerWallet.create({
      fetch: (input, init) => host.network.fetch(input, init),
      persistCheckpoint: async (checkpoint) => {
        if (!storageKey || !cipher) throw new Error("Railgun checkpoint storage scope is unavailable");
        await host.storage.set(storageKey, await cipher.encrypt(checkpoint));
      },
    });
    try {
      try { await wallet.chainConfig(chainId); }
      catch (error) {
        if (error instanceof Error && error.message === `Railgun is not configured for chain ID ${chainId}`) {
          throw new UnsupportedChainError(chainId);
        }
        throw error;
      }
      const address = await wallet.deriveAddress(spendingKey, viewingKey, chainId);
      storageKey = `railgun-v1:${chainId}:${address.toLowerCase()}:${accountIndex}`;
      cipher = await createCheckpointCipher(viewingKey, storageKey);
      const storedCheckpoint = await host.storage.get(storageKey);
      const checkpointJson = storedCheckpoint === null ? undefined : await cipher.decrypt(storedCheckpoint);
      await wallet.initialize({
        chainId,
        rpcUrl: options.rpcUrl,
        spendingKey,
        viewingKey,
        checkpointJson,
        artifactBaseUrl: options.artifactBaseUrl,
      });
      if (wallet.chain.chainId !== chainId || wallet.address !== address) {
        throw new Error("Railgun wallet chain or address differs from its checkpoint scope");
      }
      return new RailgunProtocol(host, wallet, options.accountSigningPath, options.bundlerUrl, chainId);
    } catch (error) {
      wallet.close();
      throw error;
    }
  }

  private async assertHostChain(): Promise<void> {
    const hostChain = await this.host.provider.getChainId();
    if (hostChain !== this.chainId) {
      throw new Error(`Host provider chain ${hostChain} does not match Railgun chain ${this.chainId}`);
    }
  }

  private async accountPrivateKey(): Promise<Hex> {
    const keystore = scopeKeystore(this.host.keystore, { prefixes: [], paths: [this.accountSigningPath] });
    return keystore.deriveAt(this.accountSigningPath);
  }

  instanceId(): Promise<RailgunAddress> { return Promise.resolve(this.wallet.address); }
  get address(): RailgunAddress { return this.wallet.address; }
  get chain() { return this.wallet.chain; }
  get syncedBlock(): bigint { return this.wallet.syncedBlock; }
  pendingPoi() { return this.wallet.pendingPoi(); }
  poiListKeys() { return this.wallet.poiListKeys(); }
  recoveredValidTxids() { return this.wallet.recoveredValidTxids(); }
  poiStatusPerList(commitment: Hex) { return this.wallet.poiStatusPerList(commitment); }
  sync(): Promise<void> { return this.wallet.sync(); }
  syncTo(block: bigint): Promise<void> { return this.wallet.syncTo(block); }
  syncHistoryTo(block: bigint): Promise<void> { return this.wallet.syncHistoryTo(block); }
  refreshPoi(): Promise<void> { return this.wallet.refreshPoi(); }
  processPendingPoi(): Promise<PoiProcessReport> { return this.wallet.processPendingPoi(); }

  async balance(assets?: RailgunAssetId[], { sync = true }: { sync?: boolean } = {}): Promise<RailgunAssetBalance[]> {
    if (sync) await this.wallet.sync();
    const raw = await this.wallet.balances();
    const all: RailgunAssetBalance[] = raw.map((item) => ({
      asset: parseAsset(item.asset), amount: item.amount, poiStatus: item.poiStatus,
    }));
    if (!assets?.length) return all;
    return assets.flatMap((asset) => {
      const matches = all.filter((entry) => assetKey(entry.asset, this.chain.wrappedBaseToken) === assetKey(asset, this.chain.wrappedBaseToken));
      return matches.length ? matches.map((entry) => ({ ...entry, asset })) : [{ asset, amount: 0n, poiStatus: null }];
    });
  }

  async notes(assets?: RailgunAssetId[], includeSpent = false, { sync = true }: { sync?: boolean } = {}): Promise<RailgunNote[]> {
    if (includeSpent) throw new Error("Railgun WASM exposes unspent notes only");
    if (sync) await this.wallet.sync();
    const notes = await this.wallet.notes();
    if (!assets?.length) return notes;
    const keys = new Set(assets.map((asset) => assetKey(asset, this.chain.wrappedBaseToken)));
    return notes.filter((note) => keys.has(assetKey(parseAsset(note.asset), this.chain.wrappedBaseToken)));
  }

  async prepareShield(asset: RailgunAssetAmount, to?: RailgunAddress): Promise<RailgunPublicOperation> {
    return this.prepareShieldMulti([asset], to);
  }

  async prepareShieldMulti(assets: Array<AssetAmount>, to: RailgunAddress = this.address): Promise<RailgunPublicOperation> {
    await this.assertHostChain();
    const entries: ShieldEntry[] = assets.map(({ asset, amount }) => {
      if (asset.__type === "native") return { kind: "native", amount };
      if (asset.__type !== "erc20") throw new UnsupportedAssetError(asset);
      if (!ADDRESS.test(asset.contract)) throw new InvalidAddressError(asset.contract);
      return { kind: "erc20", token: asset.contract, amount };
    });
    const calls = await this.wallet.buildShieldCalls(this.chainId, to, entries);
    const approvals = new Map<string, { token: Hex; amount: bigint }>();
    for (const entry of entries) {
      if (entry.kind !== "erc20") continue;
      const key = entry.token.toLowerCase();
      const previous = approvals.get(key);
      approvals.set(key, { token: entry.token, amount: (previous?.amount ?? 0n) + entry.amount });
    }
    const approvalCalls: TxData[] = [];
    for (const { token, amount } of approvals.values()) {
      const spender = this.chain.railgunSmartWallet;
      if (this.chainId === 1n && token.toLowerCase() === USDT_MAINNET) {
        approvalCalls.push(approve(token, spender, 0n));
      }
      approvalCalls.push(approve(token, spender, amount));
    }
    return { __type: "publicOperation", txns: [...approvalCalls, ...calls] };
  }

  async prepareTransfer(asset: RailgunAssetAmount, to: RailgunAddress, options: RailgunTransferOptions = {}): Promise<RailgunPrivateOperation> {
    await this.assertHostChain();
    if (asset.amount <= 0n || asset.amount >= 1n << 120n) throw new RangeError("Railgun transfer amount must be between 1 and 2^120 - 1");
    await this.wallet.sync();
    const prepared = await this.wallet.prepareTransfer({
      recipient: to,
      token: spendToken(asset.asset, this.chain.wrappedBaseToken),
      amount: asset.amount,
      memo: options.memo,
      accountPrivateKey: await this.accountPrivateKey(),
      bundlerUrl: this.bundlerUrl,
    });
    return { __type: "privateOperation", mode: "userop", prepared, bundlerUrl: this.bundlerUrl, chainId: this.chainId };
  }

  async prepareUnshield(asset: RailgunAssetAmount, to: Hex, options: RailgunUnshieldOptions = {}): Promise<RailgunPrivateOperation> {
    await this.assertHostChain();
    if (!ADDRESS.test(to)) throw new InvalidAddressError(to);
    if (asset.amount <= 0n || asset.amount >= 1n << 120n) throw new RangeError("Railgun unshield amount must be between 1 and 2^120 - 1");
    await this.wallet.sync();
    const tailCalls = typeof options.tailCalls === "function"
      ? (await options.tailCalls(to)).map((call) => ({ target: call.to as Hex, value: call.value, data: call.data as Hex }))
      : options.tailCalls;
    const prepared = await this.wallet.prepareUnshield({
      recipient: to,
      token: spendToken(asset.asset, this.chain.wrappedBaseToken),
      amount: asset.amount,
      unwrapNative: asset.asset.__type === "native",
      tailCalls,
      accountPrivateKey: await this.accountPrivateKey(),
      bundlerUrl: this.bundlerUrl,
    });
    return { __type: "privateOperation", mode: "userop", prepared, bundlerUrl: this.bundlerUrl, chainId: this.chainId };
  }

  close(): void { this.wallet.close(); }
}

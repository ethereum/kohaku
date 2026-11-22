import type * as WasmModule from "../vendor/wasm/web/kohaku_railgun_wasm.js";
import type {
  Hex,
  PendingPoi,
  PoiProcessReport,
  PoiStatus,
  PreparedUserOperation,
  RailgunAddress,
  RailgunBalance,
  RailgunChain,
  RailgunNote,
  RailgunOpenOptions,
  ShieldEntry,
  TransactionCall,
  TransferOptions,
  UnshieldOptions,
} from "./types";

export type RailgunWasm = Pick<typeof WasmModule, "Chain" | "RailgunAddress" | "Shield" | "PoiSession">;
type WasmChain = WasmModule.Chain;
type WasmSession = WasmModule.PoiSession;

type RawBalance = Omit<RailgunBalance, "amount"> & { amount: string };
type RawNote = Omit<RailgunNote, "amount"> & { amount: string };

function knownChain(wasm: RailgunWasm, chainId: bigint): WasmChain {
  const chain = wasm.Chain.fromChainId(chainId);
  if (!chain) throw new Error(`Railgun is not configured for chain ID ${chainId}`);
  return chain;
}

function chainView(chain: WasmChain): RailgunChain {
  return {
    chainId: chain.chainId,
    deploymentBlock: chain.deploymentBlock,
    poiStartBlock: chain.poiStartBlock,
    railgunSmartWallet: chain.railgunSmartWallet as Hex,
    wrappedBaseToken: chain.wrappedBaseToken as Hex,
    unshieldFeeBps: chain.unshieldFeeBps,
    subsquidEndpoint: chain.subsquidEndpoint,
    poiEndpoint: chain.poiEndpoint,
  };
}

export function chainConfig(wasm: RailgunWasm, chainId: bigint): RailgunChain {
  const chain = knownChain(wasm, chainId);
  try {
    return chainView(chain);
  } finally {
    chain.free();
  }
}

/** Matches the pinned Rust crate and the old CLI mnemonic derivation. */
export function railgunKeyPaths(index = 0): { spending: string; viewing: string } {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffffffff) {
    throw new RangeError("Railgun key index must be a uint32");
  }
  return {
    spending: `m/44'/1984'/0'/0'/${index}'`,
    viewing: `m/420'/1984'/0'/0'/${index}'`,
  };
}

export function deriveRailgunAddress(
  wasm: RailgunWasm,
  spendingKey: Hex,
  viewingKey: Hex,
  chainId: bigint,
): RailgunAddress {
  const address = wasm.RailgunAddress.fromPrivateKeys(spendingKey, viewingKey, chainId);
  try {
    return address.toString() as RailgunAddress;
  } finally {
    address.free();
  }
}

/** Shield preparation needs no wallet sync or PPOI state. Approvals are caller-owned. */
export function buildShieldCalls(
  wasm: RailgunWasm,
  chainId: bigint,
  recipient: RailgunAddress,
  entries: readonly ShieldEntry[],
): TransactionCall[] {
  if (entries.length === 0) throw new Error("At least one shield entry is required");
  const chain = knownChain(wasm, chainId);
  try {
    const address = wasm.RailgunAddress.parse(recipient);
    try {
      const builder = new wasm.Shield(chain);
      let consumed = false;
      try {
        for (const entry of entries) {
          if (entry.amount <= 0n || entry.amount >= 1n << 120n) {
            throw new RangeError("Shield amount must be between 1 and 2^120 - 1");
          }
          if (entry.kind === "native") builder.addNative(address, entry.amount);
          else builder.addErc20(address, entry.token, entry.amount);
        }
        consumed = true;
        return builder.build() as TransactionCall[];
      } finally {
        if (!consumed) builder.free();
      }
    } finally {
      address.free();
    }
  } finally {
    chain.free();
  }
}

/** Keeps a Rust PPOI wallet open while the host owns encrypted persistence. */
export class RailgunWallet {
  readonly chain: RailgunChain;
  private closed = false;

  private constructor(
    private readonly session: WasmSession,
    private readonly rawChain: WasmChain,
    private readonly persistCheckpoint: RailgunOpenOptions["persistCheckpoint"],
    private readonly wasm: RailgunWasm,
  ) {
    this.chain = chainView(rawChain);
  }

  static async open(options: RailgunOpenOptions, wasm: RailgunWasm): Promise<RailgunWallet> {
    if (typeof options.persistCheckpoint !== "function") {
      throw new TypeError("Railgun wallet requires a checkpoint persistence callback");
    }
    const chain = knownChain(wasm, options.chainId);
    try {
      const session = await wasm.PoiSession.open(
        chain,
        options.rpcUrl,
        options.spendingKey,
        options.viewingKey,
        options.checkpointJson,
        options.artifactBaseUrl,
      );
      return new RailgunWallet(session, chain, options.persistCheckpoint, wasm);
    } catch (error) {
      chain.free();
      throw error;
    }
  }

  private current(): WasmSession {
    if (this.closed) throw new Error("Railgun wallet is closed");
    return this.session;
  }

  get address(): RailgunAddress {
    return this.current().address as RailgunAddress;
  }

  get syncedBlock(): bigint {
    return this.current().syncedBlock;
  }

  /** This contains secret notes and keys. The host must encrypt it at rest. */
  checkpointJson(): string {
    return this.current().checkpointJson();
  }

  private async save(): Promise<void> {
    await this.persistCheckpoint(this.checkpointJson());
  }

  private async stateful<T>(run: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await run();
    } catch (error) {
      try {
        await this.save();
      } catch (saveError) {
        throw new AggregateError([error, saveError], "Railgun operation and checkpoint save failed");
      }
      throw error;
    }
    await this.save();
    return result;
  }

  /** Sync UTXOs, TXIDs and PPOI lists; queue historical missing proofs. */
  async sync(): Promise<void> {
    await this.stateful(() => this.current().syncWithoutPoiSubmission());
  }

  /** Persist after each bounded window to make a first resync resumable. */
  async syncTo(block: bigint): Promise<void> {
    await this.stateful(() => this.current().syncToWithoutPoiSubmission(block));
  }

  /** Persist a history window without repeatedly catching up global PPOI data. */
  async syncHistoryTo(block: bigint): Promise<void> {
    await this.stateful(() => this.current().syncHistoryTo(block));
  }

  /** Refresh PPOI/TXIDs after the final history window; submission is explicit. */
  async refreshPoi(): Promise<void> {
    await this.stateful(() => this.current().refreshPoi());
  }

  /** Submitted means sent to the node; only a later list sync can establish Valid. */
  async processPendingPoi(): Promise<PoiProcessReport> {
    const json = await this.stateful(() => this.current().processPendingPoiJson());
    return JSON.parse(json) as PoiProcessReport;
  }

  pendingPoi(): PendingPoi[] {
    return JSON.parse(this.current().poiPendingJson()) as PendingPoi[];
  }

  poiListKeys(): string[] {
    return JSON.parse(this.current().poiListKeysJson()) as string[];
  }

  recoveredValidTxids(): string[] {
    return JSON.parse(this.current().poiRecoveredValidJson()) as string[];
  }

  poiStatusPerList(blindedCommitment: Hex): Array<[string, PoiStatus]> {
    return JSON.parse(this.current().poiStatusPerListJson(blindedCommitment)) as Array<[string, PoiStatus]>;
  }

  async balances(): Promise<RailgunBalance[]> {
    const raw = JSON.parse(await this.current().balancesJson()) as RawBalance[];
    return raw.map((entry) => ({ ...entry, amount: BigInt(entry.amount) }));
  }

  async notes(): Promise<RailgunNote[]> {
    const raw = JSON.parse(await this.current().notesJson()) as RawNote[];
    return raw.map((entry) => ({ ...entry, amount: BigInt(entry.amount) }));
  }

  /** Saves the pending PPOI proof before giving the signed operation to the caller. */
  async prepareTransfer(options: TransferOptions): Promise<PreparedUserOperation> {
    const recipient = this.wasm.RailgunAddress.parse(options.recipient);
    try {
      const json = await this.stateful(() => this.current().prepareTransferUserOpJson(
        recipient,
        options.token,
        options.amount,
        options.memo ?? "",
        options.accountPrivateKey,
        options.bundlerUrl,
      ));
      return JSON.parse(json) as PreparedUserOperation;
    } finally {
      recipient.free();
    }
  }

  /** Rust prepends WETH withdrawal when unwrapNative is set, then user calls. */
  async prepareUnshield(options: UnshieldOptions): Promise<PreparedUserOperation> {
    const tailCalls = (options.tailCalls ?? []).map((call) => ({
      target: call.target,
      value: call.value.toString(),
      data: call.data,
    }));
    const json = await this.stateful(() => this.current().prepareUnshieldUserOpJson(
      options.recipient,
      options.token,
      options.amount,
      options.unwrapNative ?? false,
      JSON.stringify(tailCalls),
      options.accountPrivateKey,
      options.bundlerUrl,
    ));
    return JSON.parse(json) as PreparedUserOperation;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.session.free();
    this.rawChain.free();
  }
}

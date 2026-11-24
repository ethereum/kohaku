import { InsufficientBalanceError, InvalidAddressError, type ERC20AssetId, type UnshieldOptions } from "@kohaku-eth/plugins";
import { isAddress } from "viem";
import { decodeAddress, type Recipient } from "../crypto/address";
import { type Hex } from "../crypto/bytes";
import { encodeTransact } from "../pool/abi";
import { type OwnedNote } from "../sync/absorb";
import { ETH, ethAmount, isEth } from "./assets";
import { type TacitContext } from "./context";
import { pickNotes, priceSpend } from "./pricing";
import { provingTree } from "./queue";
import { total, proveSpend, ZERO_ADDRESS, type Payee } from "./spend";
import {
  type TacitAssetAmount,
  type TacitBalance,
  type TacitInstance,
  type TacitMode,
  type TacitNote,
  type TacitPrivateOperation,
  type TacitPublicOperation,
  type TacitSpendOptions,
} from "./types";

export type TacitUnshieldOptions = UnshieldOptions & TacitSpendOptions;

export class TacitPlugin implements TacitInstance {
  constructor(private readonly ctx: TacitContext) {}

  instanceId = (): Promise<string> => Promise.resolve(this.ctx.keys.address);

  sync = (): Promise<void> => this.ctx.sync.sync();

  rescan = (): Promise<void> => this.ctx.sync.rescan();

  async balance(assets?: ERC20AssetId[]): Promise<TacitBalance[]> {
    await this.sync();

    const eth: TacitBalance = { asset: ETH, amount: total(this.ctx.sync.notes) };

    return assets ? assets.map((asset) => (isEth(asset) ? eth : { asset, amount: 0n })) : [eth];
  }

  /** The unspent notes. Spent notes are not kept, so `includeSpent` has nothing to add. */
  async notes(assets?: ERC20AssetId[]): Promise<TacitNote[]> {
    if (assets && !assets.some(isEth)) return [];

    await this.sync();

    return this.ctx.sync.notes.map((n) => ({
      index: n.index,
      value: BigInt(n.v),
      leaf: `0x${BigInt(n.leaf).toString(16).padStart(64, "0")}` as Hex,
      block: n.block,
    }));
  }

  async quote(): Promise<bigint> {
    return this.ctx.relayer ? BigInt((await this.ctx.relayer.quote()).fee) : 0n;
  }

  /** Deposits `asset` into the pool for `to` (default: this wallet). The user's own account sends the transaction. */
  async prepareShield(asset: TacitAssetAmount, to?: string): Promise<TacitPublicOperation> {
    const amount = ethAmount(asset);
    const payee = this.payee(to);

    await this.sync();

    const tx = await proveSpend(this.ctx, {
      tree: this.ctx.sync.tree,
      ins: [],
      outs: [{ to: payee, value: amount }, null],
      extAmount: amount,
      recipient: ZERO_ADDRESS,
      relayer: ZERO_ADDRESS,
      fee: 0n,
    });

    return { __type: "publicOperation", txns: [{ to: this.ctx.config.pool, data: encodeTransact(tx), value: amount }] };
  }

  /**
   * Pays `asset` to another pool address, privately. The recipient receives all of `amount`; a relayer's fee comes out
   * on top. The payment always has a second output (change, or a zero-value note), so one without change looks like one with.
   */
  async prepareTransfer(asset: TacitAssetAmount, to: string, options?: TacitSpendOptions): Promise<TacitPrivateOperation> {
    const amount = ethAmount(asset);
    const payee = this.payee(to);
    const mode = options?.mode ?? this.ctx.mode;
    const { fee, relayer } = await priceSpend(this.ctx, mode, options?.maxFee);
    const ins = pickNotes(this.ctx.sync.notes, amount + fee);
    const change = total(ins) - amount - fee;

    const outs: [Payee, Payee] = [{ to: payee, value: amount }, { to: this.ctx.keys, value: change }];

    return this.finish({ mode, ins, outs, extAmount: 0n, recipient: ZERO_ADDRESS, relayer, fee, amount });
  }

  /** Withdraws `asset` to a public address. */
  async prepareUnshield(asset: TacitAssetAmount, to: string, options?: TacitUnshieldOptions): Promise<TacitPrivateOperation> {
    if (options?.tailCalls) throw new Error("tacit: tailCalls are not supported");

    const amount = ethAmount(asset);

    if (!isAddress(to) || BigInt(to) === 0n) throw new InvalidAddressError(to);

    const mode = options?.mode ?? this.ctx.mode;
    const { fee, relayer } = await priceSpend(this.ctx, mode, options?.maxFee);
    const ins = pickNotes(this.ctx.sync.notes, amount + fee);
    const change = total(ins) - amount - fee;

    return this.finish({ mode, ins, outs: [this.changeOf(change), null], extAmount: -amount, recipient: to as Hex, relayer, fee, amount });
  }

  /** Merges the two largest notes into one, for a balance held in more notes than one spend can take. */
  async prepareConsolidate(options?: TacitSpendOptions): Promise<TacitPrivateOperation> {
    await this.sync();

    const ins = [...this.ctx.sync.notes].sort((a, b) => (BigInt(b.v) < BigInt(a.v) ? -1 : 1)).slice(0, 2);

    if (ins.length < 2) throw new Error("tacit: there are not two notes to merge");

    const mode = options?.mode ?? this.ctx.mode;
    const { fee, relayer } = await priceSpend(this.ctx, mode, options?.maxFee);
    const merged = total(ins) - fee;

    if (merged <= 0n) throw new InsufficientBalanceError(ETH, fee, total(ins));

    return this.finish({ mode, ins, outs: [this.changeOf(merged), null], extAmount: 0n, recipient: ZERO_ADDRESS, relayer, fee, amount: merged });
  }

  private payee(address?: string): Recipient {
    if (address === undefined) return this.ctx.keys;

    try {
      return decodeAddress(address);
    } catch {
      throw new InvalidAddressError(address);
    }
  }

  private changeOf(value: bigint): Payee | null {
    return value > 0n ? { to: this.ctx.keys, value } : null;
  }

  private async finish(spend: {
    mode: TacitMode;
    ins: OwnedNote[];
    outs: [Payee | null, Payee | null];
    extAmount: bigint;
    recipient: Hex;
    relayer: Hex;
    fee: bigint;
    amount: bigint;
  }): Promise<TacitPrivateOperation> {
    const { config, sync, relayer } = this.ctx;
    const tree = await provingTree({ sync, relayer, mode: spend.mode, inserts: spend.outs.some(Boolean) });
    const tx = await proveSpend(this.ctx, { ...spend, tree });

    return {
      __type: "privateOperation",
      mode: spend.mode,
      chainId: config.chainId,
      pool: config.pool,
      ...(spend.mode === "relayer" && this.ctx.relayer ? { relayerUrl: this.ctx.relayer.url } : {}),
      tx,
      txns: [{ to: config.pool, data: encodeTransact(tx), value: 0n }],
      amount: spend.amount,
      fee: spend.fee,
    };
  }
}

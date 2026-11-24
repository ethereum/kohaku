import { InsufficientBalanceError } from "@kohaku-eth/plugins";
import { TacitFeeError, TacitFragmentedBalanceError } from "../errors";
import { type Hex } from "../crypto/bytes";
import { type OwnedNote } from "../sync/absorb";
import { ETH } from "./assets";
import { type TacitContext } from "./context";
import { selectNotes, total, ZERO_ADDRESS } from "./spend";
import { type TacitMode } from "./types";

/** Syncs, then prices a spend: a relayer's quoted fee and address, or nothing when the user's account sends it. */
export async function priceSpend(ctx: TacitContext, mode: TacitMode, maxFee?: bigint): Promise<{ fee: bigint; relayer: Hex }> {
  await ctx.sync.sync();

  if (mode === "self") return { fee: 0n, relayer: ZERO_ADDRESS };

  if (!ctx.relayer) throw new Error("tacit: this chain has no relayer; use mode self");

  const quote = await ctx.relayer.quote();
  const fee = BigInt(quote.fee);

  if (maxFee !== undefined && fee > maxFee) throw new TacitFeeError(fee, maxFee);

  return { fee, relayer: quote.relayer };
}

/** Up to two unspent notes that cover `need`, or the error that says whether the balance or the number of notes falls short. */
export function pickNotes(notes: OwnedNote[], need: bigint): OwnedNote[] {
  const picked = selectNotes(notes, need);

  if (picked) return picked;

  const available = total(notes);

  if (available >= need) throw new TacitFragmentedBalanceError(need, available);

  throw new InsufficientBalanceError(ETH, need, available);
}

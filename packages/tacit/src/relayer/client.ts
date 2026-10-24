import { type Network } from "@kohaku-eth/plugins";
import { type TacitChainConfig } from "../config";
import { type Hex } from "../crypto/bytes";
import { TacitFeeError, TacitRelayerError, TacitStaleProofError } from "../errors";
import { type TransactTx } from "../pool/abi";
import { sleep } from "../sleep";

/** A relayer's price for one spend, and the address the proof must name as `relayer`. */
export type Quote = { chainId: number; pool: Hex; relayer: Hex; fee: string; gas: string };

/** The relayer's view of the pool: its head, the insertions queued after it, and the tail they lead to. */
export type Head = {
  root: string;
  size: string;
  pending: { outLeaf0: string; outLeaf1: string }[];
  tail: { root: string; size: string };
};

export type FeedEvent = {
  kind: string;
  nf0: string;
  nf1: string;
  outLeaf0: string;
  outLeaf1: string;
  firstIndex: number | string;
  memo0: Hex;
  memo1: Hex;
  block: number;
};

export type FeedPage = { chainId: number; pool: Hex; through: number; events: FeedEvent[] };

const NO_ANSWER = "the relayer did not answer, and it may still have sent the spend; check the pool before sending again";
const GATEWAY_FAILURES = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

/**
 * The HTTP interface of one chain's relayer. A relayer submits a spend and is paid from the shielded
 * funds in the same transaction; it cannot change the recipient, amount, relayer address or fee, because the proof
 * binds them and the pool recomputes the binding.
 */
export class TacitRelayerClient {
  constructor(
    private readonly network: Network,
    private readonly config: TacitChainConfig,
    readonly url: string,
  ) {}

  // A busy relayer answers 429 with Retry-After: wait what it says (10 s unread, at most 30) and ask again.
  private async request(path: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const response = await this.network.fetch(`${this.url}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });

      if (response.status !== 429 || attempt >= 4) return response;

      const after = Number(response.headers.get("retry-after"));

      await sleep(Math.min(after > 0 ? after : 10, 30) * 1000 * (0.5 + Math.random()));
    }
  }

  private async get<T>(path: string): Promise<T> {
    const response = await this.request(path);
    const body = (await response.json().catch(() => ({}))) as T & { error?: string };

    if (!response.ok) throw new TacitRelayerError(body.error ?? `relayer returned ${response.status}`, response.status);

    return body;
  }

  /** The relayer's quote, checked before anything is signed: this chain and pool, the expected address, a fee within the ceiling. */
  async quote(gas?: number): Promise<Quote> {
    const q = await this.get<Quote>(gas ? `/quote?gas=${gas}` : "/quote");

    if (Number(q.chainId) !== this.config.chainId || String(q.pool).toLowerCase() !== this.config.pool.toLowerCase()) {
      throw new TacitRelayerError("the relayer quoted another chain or pool");
    }

    const expected = this.config.relayerAddress?.toLowerCase();

    if (!/^0x[0-9a-fA-F]{40}$/.test(q.relayer ?? "") || (expected && q.relayer.toLowerCase() !== expected)) {
      throw new TacitRelayerError("the relayer quoted an address this plugin does not expect");
    }

    if (!/^\d+$/.test(String(q.fee))) throw new TacitRelayerError("the relayer quoted a fee that is not a number");

    if (BigInt(q.fee) > this.config.maxRelayFee) throw new TacitFeeError(BigInt(q.fee), this.config.maxRelayFee);

    return q;
  }

  head(): Promise<Head> {
    return this.get<Head>("/head");
  }

  events(from: number): Promise<FeedPage> {
    return this.get<FeedPage>(`/events?from=${from}`);
  }

  /** Submits a proven spend. → the transaction hash. */
  relay(tx: TransactTx): Promise<Hex> {
    return relaySpend(this.network, this.url, tx);
  }
}

/** Submits a proven spend to the relayer at `url`. → the transaction hash. */
export async function relaySpend(network: Network, url: string, tx: TransactTx): Promise<Hex> {
  let response: Response;

  try {
    response = await network.fetch(`${url}/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tx }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    // A request that got no answer may still have been sent.
    throw new TacitRelayerError(NO_ANSWER);
  }

  const body = (await response.json().catch(() => ({}))) as { txHash?: Hex; error?: string; stale?: boolean; needFee?: string };

  if (response.ok && body.txHash) return body.txHash;

  const why = String(body.error ?? "");

  // A gateway failure with no answer from the relayer says nothing about whether it sent the spend.
  if (GATEWAY_FAILURES.has(response.status) && !why) {
    throw new TacitRelayerError(NO_ANSWER, response.status);
  }

  if (/AlreadyNullified|already spent/.test(why)) {
    throw new TacitRelayerError("those funds were already spent; call rescan() and prepare the operation again", response.status);
  }

  if (/already being relayed/.test(why)) throw new TacitRelayerError("a spend of these funds is already on its way", response.status);

  if (response.status === 409 && body.stale) throw new TacitStaleProofError(why);

  if (/^\d+$/.test(String(body.needFee ?? ""))) throw new TacitFeeError(BigInt(body.needFee!), BigInt(tx.fee));

  throw new TacitRelayerError(why || `relayer returned ${response.status}`, response.status);
}

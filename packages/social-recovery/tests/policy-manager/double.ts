import type { Address, BlockHeader, BlockTag, Hex, IProvider, RawLog, RawTransaction } from '../../src/index';

/** One `eth_call` the part asked the double for. */
export type CallRecord = {
  readonly to: Address;
  readonly data: Hex;
  readonly from: Address;
  readonly block: BlockTag;
};

/** What the double does with one call: return bytes, revert with data, or fail as a transport would. */
export type Answer =
  | { readonly returns: Hex }
  | { readonly reverts: Hex }
  | { readonly rejects: unknown };

/** Decides the answer to one call. */
export type Answerer = (call: CallRecord) => Answer;

/** A header the double hands out for `block(tag)`; numbers rise by one on each read so two reads are told apart. */
export const headerAt = (number: number): BlockHeader => ({
  number,
  timestamp: 1_800_000_000 + number,
  hash: `0x${number.toString(16).padStart(64, 'a')}`,
});

/** The first block number the double answers. */
export const FIRST_BLOCK = 21_000_000;

/** An integrator's provider written for the tests, recording every read the part makes. */
export class ProviderDouble implements IProvider {
  readonly calls: CallRecord[] = [];
  readonly blockTags: BlockTag[] = [];
  readonly headers: BlockHeader[] = [];
  codeReads = 0;
  logReads = 0;
  chainIdReads = 0;
  transactionReads = 0;
  blockFailure: unknown = undefined;

  constructor(private readonly answerer: Answerer = () => ({ rejects: new Error('no answer set') })) {}

  async chainId(): Promise<number> {
    this.chainIdReads += 1;

    return 1;
  }

  async call(to: Address, data: Hex, from: Address, block: BlockTag): Promise<Hex> {
    const record = { to, data, from, block };

    this.calls.push(record);

    const answer = this.answerer(record);

    if ('returns' in answer) return answer.returns;

    if ('reverts' in answer) throw { data: answer.reverts };

    throw answer.rejects;
  }

  async logs(): Promise<readonly RawLog[]> {
    this.logReads += 1;

    return [];
  }

  async block(tag: BlockTag): Promise<BlockHeader> {
    this.blockTags.push(tag);

    if (this.blockFailure !== undefined) throw this.blockFailure;

    const header = headerAt(FIRST_BLOCK + this.headers.length);

    this.headers.push(header);

    return header;
  }

  async code(): Promise<Hex> {
    this.codeReads += 1;

    return '0x';
  }

  async transaction(): Promise<RawTransaction | undefined> {
    this.transactionReads += 1;

    throw new Error('transaction is not the manager part\'s');
  }

  /** The selectors of every call made, in order. */
  selectors(): string[] {
    return this.calls.map((call) => call.data.slice(0, 10).toLowerCase());
  }
}

/** A double answering every call by its selector, failing as a transport would on a selector it was not given. */
export const bySelector = (answers: Readonly<Record<string, Answer>>): ProviderDouble =>
  new ProviderDouble((call) => answers[call.data.slice(0, 10).toLowerCase()] ?? { rejects: new Error(`unexpected call ${call.data.slice(0, 10)}`) });

/** A double answering every call with the same answer. */
export const always = (answer: Answer): ProviderDouble => new ProviderDouble(() => answer);

import type { Address, BlockHeader, BlockTag, Hex, IProvider } from '../../src/index';

/** One `call` the double received. */
export type SeenCall = { readonly to: Address; readonly data: Hex; readonly from: Address; readonly block: BlockTag };

/** What the double answers one call with: return bytes, or a rejection it throws as given. */
export type CallAnswer = { readonly returns: Hex } | { readonly rejects: unknown };

/** A provider double that answers each call by its 4-byte selector and records every read it serves. */
export type ProviderDouble = {
  readonly provider: IProvider;
  readonly calls: SeenCall[];
  readonly blockTags: BlockTag[];
  readonly codeReads: number;
  readonly logReads: number;
  readonly chainIdReads: number;
  readonly transactionReads: number;
};

/** The header every `block` read answers, so a pinned block is recognisable in a prepared call. */
export const HEADER: BlockHeader = {
  number: 19_283_746,
  timestamp: 1_760_000_000,
  hash: '0x5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a',
};

/** A provider double whose `call` answers from the selector table and fails loudly on any selector it lacks. */
export function providerDouble(answers: Readonly<Record<string, CallAnswer>> = {}, header: BlockHeader = HEADER): ProviderDouble {
  const calls: SeenCall[] = [];
  const blockTags: BlockTag[] = [];
  const counts = { code: 0, logs: 0, chainId: 0, transaction: 0 };

  const provider: IProvider = {
    async chainId() {
      counts.chainId += 1;

      return 11_155_111;
    },
    async call(to, data, from, block) {
      calls.push({ to, data, from, block });

      const answer = answers[data.slice(0, 10).toLowerCase()];

      if (answer === undefined) throw new Error(`the double has no answer for ${data.slice(0, 10)}`);

      if ('rejects' in answer) throw answer.rejects;

      return answer.returns;
    },
    async logs() {
      counts.logs += 1;

      return [];
    },
    async block(tag) {
      blockTags.push(tag);

      return header;
    },
    async code() {
      counts.code += 1;

      return '0x';
    },
    async transaction() {
      counts.transaction += 1;

      throw new Error('transaction is not the action part\'s');
    },
  };

  return {
    provider,
    calls,
    blockTags,
    get codeReads() {
      return counts.code;
    },
    get logReads() {
      return counts.logs;
    },
    get chainIdReads() {
      return counts.chainId;
    },
    get transactionReads() {
      return counts.transaction;
    },
  };
}

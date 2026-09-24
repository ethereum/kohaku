// The ABI entry shapes the exported ABIs use, and the typed error the error
// decoding of D-205 answers with. Line numbers are design/offchain/sdk.md.
import type { Hex } from './chain';

/** One parameter of a Solidity JSON ABI entry. */
export type AbiParameter = {
  readonly name: string;
  readonly type: string;
  readonly components?: readonly AbiParameter[];
};

/** One error of a Solidity JSON ABI. */
export type AbiErrorItem = {
  readonly type: 'error';
  readonly name: string;
  readonly inputs: readonly AbiParameter[];
};

/** One function of a Solidity JSON ABI. */
export type AbiFunctionItem = {
  readonly type: 'function';
  readonly name: string;
  readonly inputs: readonly AbiParameter[];
  readonly outputs: readonly AbiParameter[];
  readonly stateMutability: 'pure' | 'view' | 'nonpayable' | 'payable';
};

/**
 * The error ABI set exported beside `decodeRevert`: the twenty-five rows of the
 * kit, the language pair and the pinned account revision's reverts (D-205 l.1159, l.1189, l.1191).
 */
export type ErrorAbi = readonly AbiErrorItem[];

/** Who raised a decoded error, the closed set of D-205 l.1191. */
export const KIT_ERROR_SOURCES = ['manager', 'action', 'account', 'language'] as const;

export type KitErrorSource = (typeof KIT_ERROR_SOURCES)[number];

/** One decoded argument value: integers as bigint, addresses and bytes as hex, arrays as lists. */
export type KitErrorValue = bigint | boolean | string | readonly KitErrorValue[];

/**
 * What `decodeRevert` answers (D-201 drawing l.343, D-205 l.1191, l.1194): a
 * known error with its source, name, selector and argument values by name, or
 * the unknown result with the selector where one exists and the raw bytes.
 */
export type KitError =
  | {
      readonly known: true;
      readonly source: KitErrorSource;
      readonly name: string;
      readonly selector: Hex;
      readonly args: { readonly [argument: string]: KitErrorValue };
    }
  | {
      readonly known: false;
      /** Absent where the data is shorter than four bytes, an empty revert among them. */
      readonly selector?: Hex;
      readonly data: Hex;
    };

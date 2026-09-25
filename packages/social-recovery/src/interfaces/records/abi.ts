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

/** The error ABI set exported beside `decodeRevert`. */
export type ErrorAbi = readonly AbiErrorItem[];

/** Who raised a decoded error. */
export const KIT_ERROR_SOURCES = ['manager', 'action', 'account', 'language'] as const;

export type KitErrorSource = (typeof KIT_ERROR_SOURCES)[number];

/** One decoded argument value: integers as bigint, addresses and bytes as hex, arrays as lists. */
export type KitErrorValue = bigint | boolean | string | readonly KitErrorValue[];

/** The `decodeRevert` result. */
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
      /** Absent where the data is shorter than four bytes. */
      readonly selector?: Hex;
      readonly data: Hex;
    };

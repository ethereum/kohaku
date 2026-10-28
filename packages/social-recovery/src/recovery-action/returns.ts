import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { RECOVERY_ACTION_BOOL_RETURN_ABI, RECOVERY_ACTION_STRING_RETURN_ABI } from '../constants';
import { decodeStrictly } from '../formats/strict';
import type { Hex } from '../interfaces';

/** Decodes return data strictly, throwing a `TypeError` for bytes that are not the canonical encoding of the one value. */
function strictReturn<Value>(returned: Hex, view: string, layout: string, codec: { decode: (bytes: Hex) => Value; encode: (value: Value) => Hex }): Value {
  try {
    return decodeStrictly(returned, `${view} return data`, layout, {
      decode: codec.decode,
      build: (value) => value,
      encode: codec.encode,
    });
  } catch (cause) {
    throw new TypeError(`${view} return data does not decode as one ${layout}`, { cause });
  }
}

/** A boolean view's answer, refusing a word other than 0 or 1, a short return and trailing bytes. */
export const boolReturn = (returned: Hex, view: string): boolean =>
  strictReturn(returned, view, 'bool', {
    decode: (bytes) => decodeAbiParameters(RECOVERY_ACTION_BOOL_RETURN_ABI, bytes)[0],
    encode: (value) => encodeAbiParameters(RECOVERY_ACTION_BOOL_RETURN_ABI, [value]),
  });

/** A string view's answer, refusing bytes that are not one canonically encoded string. */
export const stringReturn = (returned: Hex, view: string): string =>
  strictReturn(returned, view, 'string', {
    decode: (bytes) => decodeAbiParameters(RECOVERY_ACTION_STRING_RETURN_ABI, bytes)[0],
    encode: (value) => encodeAbiParameters(RECOVERY_ACTION_STRING_RETURN_ABI, [value]),
  });

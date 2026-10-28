import { decodeAbiParameters, encodeAbiParameters, toFunctionSelector } from 'viem';
import {
  ERRORS_ABI_BY_SOURCE,
  ERRORS_BYTES_TYPE,
  ERRORS_SELECTOR_SIZE,
  ERRORS_STRING_TYPE,
  ERRORS_TUPLE_TYPE,
  FORMATS_HEX_BYTES_PATTERN,
} from '../constants';
import { KIT_ERROR_SOURCES, type AbiErrorItem, type AbiParameter, type Hex, type KitError, type KitErrorValue } from '../interfaces';
import type { SourcedError } from '../types/errors';

/** A parameter's canonical type, a tuple spelled out as its components. */
function canonicalType(parameter: AbiParameter): string {
  if (!parameter.type.startsWith(ERRORS_TUPLE_TYPE)) return parameter.type;

  const components = (parameter.components ?? []).map(canonicalType).join(',');

  return `(${components})${parameter.type.slice(ERRORS_TUPLE_TYPE.length)}`;
}

/** The error's four-byte selector over its canonical signature, lower case. */
export const errorSelector = (item: AbiErrorItem): Hex =>
  toFunctionSelector(`${item.name}(${item.inputs.map(canonicalType).join(',')})`);

let bySelector: ReadonlyMap<string, SourcedError> | undefined;

/** Every error of the set by its selector, built once; the first entry of a selector is the one kept. */
function errorsBySelector(): ReadonlyMap<string, SourcedError> {
  if (bySelector !== undefined) return bySelector;

  const table = new Map<string, SourcedError>();

  for (const source of KIT_ERROR_SOURCES) {
    for (const item of ERRORS_ABI_BY_SOURCE[source]) {
      const selector = errorSelector(item);

      if (!table.has(selector)) table.set(selector, { source, item });
    }
  }

  bySelector = table;

  return table;
}

/** A decoded ABI value as a `KitErrorValue`: integers as bigint, a tuple as its components in order. */
function asKitValue(value: unknown): KitErrorValue {
  if (typeof value === 'number') return BigInt(value);

  if (typeof value === 'bigint' || typeof value === 'boolean' || typeof value === 'string') return value;

  if (Array.isArray(value)) return value.map(asKitValue);

  return Object.values(value as object).map(asKitValue);
}

/** The parameters with every `string`, nested ones included, read as `bytes`, so a round trip compares bytes rather than text. */
function asByteParameters(parameters: readonly AbiParameter[]): AbiParameter[] {
  return parameters.map((parameter) => ({
    ...parameter,
    type: parameter.type.startsWith(ERRORS_STRING_TYPE)
      ? `${ERRORS_BYTES_TYPE}${parameter.type.slice(ERRORS_STRING_TYPE.length)}`
      : parameter.type,
    ...(parameter.components === undefined ? {} : { components: asByteParameters(parameter.components) }),
  }));
}

/** The named arguments, or undefined where the bytes are not the canonical encoding of the error's inputs. */
function decodeArguments(item: AbiErrorItem, encoded: Hex): Extract<KitError, { readonly known: true }>['args'] | undefined {
  try {
    const byteInputs = asByteParameters(item.inputs);

    if (encodeAbiParameters(byteInputs, decodeAbiParameters(byteInputs, encoded)).toLowerCase() !== encoded.toLowerCase()) {
      return undefined;
    }

    const values = decodeAbiParameters(item.inputs, encoded);

    return Object.fromEntries(
      item.inputs.map((parameter, index) => [parameter.name === '' ? String(index) : parameter.name, asKitValue(values[index])]),
    );
  } catch {
    return undefined;
  }
}

/**
 * The revert data as a typed error with its source and named arguments, or the unknown result carrying the raw bytes.
 * Never throws; arguments that are not the canonical encoding under a known selector give the unknown result.
 */
export function decodeRevert(data: Hex): KitError {
  try {
    if (typeof data !== 'string' || !FORMATS_HEX_BYTES_PATTERN.test(data)) return { known: false, data };

    const width = 2 + 2 * ERRORS_SELECTOR_SIZE;

    if (data.length < width) return { known: false, data };

    const selector = data.slice(0, width).toLowerCase() as Hex;
    const match = errorsBySelector().get(selector);
    const args = match === undefined ? undefined : decodeArguments(match.item, `0x${data.slice(width)}`);

    if (match === undefined || args === undefined) return { known: false, selector, data };

    return { known: true, source: match.source, name: match.item.name, selector, args };
  } catch {
    return { known: false, data };
  }
}

import type { Hex } from '../interfaces';
import { assertBytes } from './guards';

/**
 * Decodes bytes and refuses any the matching encoder would not reproduce, so a decoded value re-encodes to its input.
 * Bytes that do not decode throw a `RangeError`; `build` and `encode` throw their own refusals unchanged.
 */
export function decodeStrictly<Raw, Value>(
  encoded: Hex,
  name: string,
  layout: string,
  steps: { decode: (bytes: Hex) => Raw; build: (raw: Raw) => Value; encode: (value: Value) => Hex },
): Value {
  assertBytes(encoded, name);

  let raw: Raw;

  try {
    raw = steps.decode(encoded);
  } catch (cause) {
    throw new RangeError(`${name} does not decode as ${layout}`, { cause });
  }

  const value = steps.build(raw);

  if (steps.encode(value) !== encoded.toLowerCase()) {
    throw new RangeError(`${name} is not in the canonical encoding of ${layout}`);
  }

  return value;
}

import { Point } from '@noble/ed25519';
import { bytesToHex } from 'ethereum-cryptography/utils';
import EngineDebug from '../debugger/debugger';
import { ByteLength, ByteUtils } from './bytes';
import { isReactNative } from './runtime';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

interface ScalarMultMod {
  default?: () => Promise<void>;
  scalarMultiply?: (point: Uint8Array, scalar: Uint8Array) => Uint8Array;
}

const { default: initCurve25519wasm, scalarMultiply: scalarMultiplyWasm } =
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  isReactNative
    ? ({} as unknown as ScalarMultMod)
    : (require('@railgun-community/curve25519-scalarmult-wasm') as ScalarMultMod)

const initCurve25519Wasm = (): Promise<void> => {
  try {
    // Try WASM implementation.
    return typeof initCurve25519wasm === 'function' ? initCurve25519wasm() : Promise.resolve();
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from initCurve25519Wasm', { cause });
    }
    // Fallback to Javascript. No init needed.
    EngineDebug.log('curve25519-scalarmult-wasm init failed: Fallback to JavaScript');
    EngineDebug.error(cause);
    return Promise.resolve();
  }
};
export const initCurve25519Promise = initCurve25519Wasm();

export const scalarMultiplyWasmFallbackToJavascript = (
  point: Uint8Array,
  scalar: bigint,
): Uint8Array => {
  if (isReactNative || !scalarMultiplyWasm) {
    // Fallback to JavaScript if this module is running directly in React Native
    return scalarMultiplyJavascript(point, scalar);
  }
  try {
    // Try WASM implementation.
    const scalarUint8Array = ByteUtils.nToBytes(scalar, ByteLength.UINT_256);
    return scalarMultiplyWasm(point, scalarUint8Array);
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from scalarMultiplyWasmFallbackToJavascript', { cause });
    }
    if (cause.message.includes('invalid y coordinate')) {
      // Noble/ed25519 would also throw this error, so no need to call Noble
      throw new Error('scalarMultiply failed', { cause });
    }
    // Fallback to Javascript.
    EngineDebug.log('curve25519-scalarmult-wasm scalarMultiply failed: Fallback to JavaScript');
    EngineDebug.error(cause);
    return scalarMultiplyJavascript(point, scalar);
  }
};

export const scalarMultiplyJavascript = (point: Uint8Array, scalar: bigint) => {
  const pk = Point.fromHex(bytesToHex(point));
  return pk.multiply(scalar).toRawBytes();
};

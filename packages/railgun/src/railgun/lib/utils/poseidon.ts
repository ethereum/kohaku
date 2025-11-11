import circom from '@railgun-community/circomlibjs';
import { EngineDebug } from '../debugger/debugger';
import { ByteLength, ByteUtils } from './bytes';
import { isReactNative } from './runtime';

interface PoseidonModule {
  default?: () => Promise<void>;
  poseidon?: (args: Array<bigint>) => bigint;
  poseidonHex?: (args: Array<string>) => string;
}

let poseidonModule: PoseidonModule | null = null;

function getPoseidonModule(): PoseidonModule {
  if (poseidonModule) {
    return poseidonModule;
  }

  if (isReactNative) {
    poseidonModule = {} as PoseidonModule;

    return poseidonModule;
  }

  try {
    // @ts-expect-error - webpack will handle this as an external
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    poseidonModule = require('@railgun-community/poseidon-hash-wasm') as PoseidonModule;

    return poseidonModule;
  } catch {
    poseidonModule = {} as PoseidonModule;

    return poseidonModule;
  }
}

const { default: initPoseidonWasm, poseidon: poseidonWasm, poseidonHex: poseidonHexWasm } = {
  get default() {
    return getPoseidonModule().default;
  },
  get poseidon() {
    return getPoseidonModule().poseidon;
  },
  get poseidonHex() {
    return getPoseidonModule().poseidonHex;
  }
} as PoseidonModule;

const initPoseidon = (): Promise<void> => {
  try {
    // Try WASM implementation.
    return typeof initPoseidonWasm === 'function' ? initPoseidonWasm() : Promise.resolve();
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from initPoseidon', { cause });
    }

    // Fallback to Javascript. No init needed.
    EngineDebug.log('poseidon-hash-wasm init failed: Fallback to JavaScript');
    EngineDebug.error(cause);

    return Promise.resolve();
  }
};

export const initPoseidonPromise = initPoseidon();

export const poseidon = (args: Array<bigint>): bigint => {
  if (isReactNative || !poseidonWasm) {
    // Fallback to JavaScript if this module is running directly in React Native
    return circom.poseidon(args);
  }

  try {
    // Try WASM implementation.
    return poseidonWasm(args);
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from poseidon', { cause });
    }

    // Fallback to Javascript.
    EngineDebug.log('poseidon in WASM failed: Fallback to JavaScript');
    EngineDebug.error(cause);

    return circom.poseidon(args);
  }
};

export const poseidonHex = (args: Array<string>): string => {
  if (isReactNative || !poseidonHexWasm) {
    return ByteUtils.nToHex(
      circom.poseidon(args.map((x) => ByteUtils.hexToBigInt(x))),
      ByteLength.UINT_256,
    );
  }

  try {
    // We need to strip 0x prefix from hex strings before passing to WASM,
    // however, let's first make sure we actually need to do this, to avoid
    // creating an unnecessary copy of the array (via `map`)
    const needsStripping = args.some((arg) => arg.startsWith('0x'));
    const strippedArgs = needsStripping ? args.map((x) => ByteUtils.strip0x(x)) : args;

    return ByteUtils.padToLength(poseidonHexWasm(strippedArgs), ByteLength.UINT_256) as string;
  } catch (cause) {
    if (!(cause instanceof Error)) {
      throw new Error('Non-error thrown from poseidonHex', { cause });
    }

    // Fallback to Javascript.
    EngineDebug.log('poseidonHex in WASM failed: Fallback to JavaScript');
    EngineDebug.error(cause);

    return ByteUtils.nToHex(
      circom.poseidon(args.map((x) => ByteUtils.hexToBigInt(x))),
      ByteLength.UINT_256,
    );
  }
};

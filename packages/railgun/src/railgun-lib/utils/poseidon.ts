import circom from '@railgun-community/circomlibjs';
import { EngineDebug } from '../debugger/debugger';
import { ByteLength, ByteUtils } from './bytes';
import { isReactNative, isNodejs } from './runtime';

interface PoseidonModule {
  default?: () => Promise<void>;
  poseidon?: (args: Array<bigint>) => bigint;
  poseidonHex?: (args: Array<string>) => string;
}

// Lazy load the wasm module - will be undefined in browser builds
let wasmModule: PoseidonModule | undefined;
let wasmLoadAttempted = false;

const getPoseidonModule = (): PoseidonModule => {
  // In browser/React Native, always use JavaScript fallback
  if (isReactNative || !isNodejs) {
    return {} as PoseidonModule;
  }

  // In Node.js, try to dynamically import the WASM module
  if (!wasmLoadAttempted) {
    wasmLoadAttempted = true;
    try {
      // Use dynamic import which won't fail at module load time
      // This makes the import optional for browser builds
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      wasmModule = require('@railgun-community/poseidon-hash-wasm') as PoseidonModule;
    } catch (e) {
      EngineDebug.log('Failed to load poseidon-hash-wasm, using JavaScript fallback');
      wasmModule = {} as PoseidonModule;
    }
  }
  return wasmModule || ({} as PoseidonModule);
};

const initPoseidon = (): Promise<void> => {
  try {
    const mod = getPoseidonModule();
    // Try WASM implementation.
    return typeof mod.default === 'function' ? mod.default() : Promise.resolve();
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
  const mod = getPoseidonModule();
  if (isReactNative || !isNodejs || !mod.poseidon) {
    // Fallback to JavaScript if this module is running directly in React Native or browser
    return circom.poseidon(args);
  }
  try {
    // Try WASM implementation.
    return mod.poseidon(args);
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
  const mod = getPoseidonModule();
  if (isReactNative || !isNodejs || !mod.poseidonHex) {
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
    return ByteUtils.padToLength(mod.poseidonHex(strippedArgs), ByteLength.UINT_256) as string;
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

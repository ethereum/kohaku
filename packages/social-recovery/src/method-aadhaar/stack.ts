import { METHOD_AADHAAR_STACK_CALLS, METHOD_AADHAAR_STACK_PACKAGE } from '../constants/method-aadhaar';
import type { AadhaarCoreSurface, AnonAadhaarArtifacts, AnonAadhaarStack } from '../types';

/** Thrown when the default stack cannot be loaded or initialised. */
export class AadhaarStackUnavailable extends Error {}

const isObject = (value: unknown): value is { readonly [name: string]: unknown } =>
  (typeof value === 'object' || typeof value === 'function') && value !== null;

function isLoaded(value: unknown): value is AadhaarCoreSurface {
  return (
    isObject(value) &&
    METHOD_AADHAAR_STACK_CALLS.every((name) => typeof value[name] === 'function') &&
    isObject(value['ArtifactsOrigin'])
  );
}

/** The package root, whose CommonJS exports arrive as named members or under `default`. */
async function importCore(): Promise<AadhaarCoreSurface> {
  // `as string` keeps the compiler out of the package's source; the bundle keeps the specifier.
  const imported: unknown = await import('@anon-aadhaar/core' as string);
  const surface = isObject(imported) && !isLoaded(imported) ? imported['default'] : imported;

  if (!isLoaded(surface)) throw new AadhaarStackUnavailable(`${METHOD_AADHAAR_STACK_PACKAGE} does not expose the expected calls`);

  return surface;
}

/** Imports the peer and calls its `init`; a refused `init` is the device's failure, not the material's. */
async function initialise(artifacts: AnonAadhaarArtifacts): Promise<AadhaarCoreSurface> {
  let core: AadhaarCoreSurface;

  try {
    core = await importCore();
  } catch (error) {
    if (error instanceof AadhaarStackUnavailable) throw error;

    throw new AadhaarStackUnavailable(`${METHOD_AADHAAR_STACK_PACKAGE} is not installed`);
  }

  const origin = core.ArtifactsOrigin[artifacts.artifactsOrigin];

  if (typeof origin !== 'number') throw new AadhaarStackUnavailable('the stack names no such artifacts origin');

  try {
    await core.init({ ...artifacts, artifactsOrigin: origin });
  } catch (error) {
    throw new AadhaarStackUnavailable('the stack could not initialise with the given artifacts', { cause: error });
  }

  return core;
}

/** The default stack, loaded on first use; without artifacts every call rejects with `AadhaarStackUnavailable`. */
export function coreStack(artifacts: AnonAadhaarArtifacts | undefined): AnonAadhaarStack {
  let loading: Promise<AadhaarCoreSurface> | undefined;

  const load = (): Promise<AadhaarCoreSurface> => {
    if (artifacts === undefined) return Promise.reject(new AadhaarStackUnavailable('no artifacts were given'));

    loading ??= initialise(artifacts).catch((error: unknown) => {
      loading = undefined;

      throw error;
    });

    return loading;
  };

  return {
    generateArgs: async (options) =>
      (await load()).generateArgs({ ...options, fieldsToRevealArray: [...options.fieldsToRevealArray] }),
    prove: async (args, onProgress) => (await load()).prove(args, onProgress),
    verify: async (pcd) => (await load()).verify(pcd),
  };
}

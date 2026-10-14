import {
  METHOD_AADHAAR_NO_ARTIFACTS_MESSAGE,
  METHOD_AADHAAR_STACK_CALLS,
  METHOD_AADHAAR_STACK_DEFAULT_MEMBER,
  METHOD_AADHAAR_STACK_INIT_MESSAGE,
  METHOD_AADHAAR_STACK_MISSING_MESSAGE,
  METHOD_AADHAAR_STACK_ORIGIN_MESSAGE,
  METHOD_AADHAAR_STACK_ORIGINS_MEMBER,
  METHOD_AADHAAR_STACK_PACKAGE,
  METHOD_AADHAAR_STACK_SURFACE_MESSAGE,
} from '../constants/method-aadhaar';
import { assertDependency } from '../formats/guards';
import type { AadhaarCoreSurface, AnonAadhaarArtifacts, AnonAadhaarStack } from '../types/method-aadhaar';
import { isRecord } from './inputs';

/** Thrown when the default stack cannot be loaded or initialised. */
export class AadhaarStackUnavailable extends Error {}

function isLoaded(value: unknown): value is AadhaarCoreSurface {
  try {
    assertDependency(value, METHOD_AADHAAR_STACK_CALLS, METHOD_AADHAAR_STACK_PACKAGE);
  } catch {
    return false;
  }

  return isRecord(value) && isRecord(value[METHOD_AADHAAR_STACK_ORIGINS_MEMBER]);
}

/** The package root, whose CommonJS exports arrive as named members or under `default`. */
async function importCore(): Promise<AadhaarCoreSurface> {
  // `as string` keeps the compiler out of the package's source; the bundle keeps the specifier.
  const imported: unknown = await import('@anon-aadhaar/core' as string);
  const surface = isRecord(imported) && !isLoaded(imported) ? imported[METHOD_AADHAAR_STACK_DEFAULT_MEMBER] : imported;

  if (!isLoaded(surface)) throw new AadhaarStackUnavailable(`${METHOD_AADHAAR_STACK_PACKAGE} ${METHOD_AADHAAR_STACK_SURFACE_MESSAGE}`);

  return surface;
}

/** Imports the peer and calls its `init`; a refused `init` is the device's failure, not the material's. */
async function initialise(artifacts: AnonAadhaarArtifacts): Promise<AadhaarCoreSurface> {
  let core: AadhaarCoreSurface;

  try {
    core = await importCore();
  } catch (error) {
    if (error instanceof AadhaarStackUnavailable) throw error;

    throw new AadhaarStackUnavailable(`${METHOD_AADHAAR_STACK_PACKAGE} ${METHOD_AADHAAR_STACK_MISSING_MESSAGE}`);
  }

  const origin = core.ArtifactsOrigin[artifacts.artifactsOrigin];

  if (typeof origin !== 'number') throw new AadhaarStackUnavailable(METHOD_AADHAAR_STACK_ORIGIN_MESSAGE);

  try {
    await core.init({ ...artifacts, artifactsOrigin: origin });
  } catch (error) {
    throw new AadhaarStackUnavailable(METHOD_AADHAAR_STACK_INIT_MESSAGE, { cause: error });
  }

  return core;
}

/** The default stack, loaded on first use; without artifacts every call rejects with `AadhaarStackUnavailable`. */
export function coreStack(artifacts: AnonAadhaarArtifacts | undefined): AnonAadhaarStack {
  let loading: Promise<AadhaarCoreSurface> | undefined;

  const load = (): Promise<AadhaarCoreSurface> => {
    if (artifacts === undefined) return Promise.reject(new AadhaarStackUnavailable(METHOD_AADHAAR_NO_ARTIFACTS_MESSAGE));

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

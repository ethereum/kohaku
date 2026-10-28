import {
  METHOD_AADHAAR_STACK_CALLS,
  METHOD_AADHAAR_STACK_DEFAULT_MEMBER,
  METHOD_AADHAAR_STACK_INIT_MESSAGE,
  METHOD_AADHAAR_STACK_KEY_MEMBERS,
  METHOD_AADHAAR_STACK_MISSING_MESSAGE,
  METHOD_AADHAAR_STACK_ORIGIN_MESSAGE,
  METHOD_AADHAAR_STACK_ORIGINS_MEMBER,
  METHOD_AADHAAR_STACK_PACKAGE,
  METHOD_AADHAAR_STACK_SURFACE_MESSAGE,
  METHOD_AADHAAR_STACK_TIME_CALLS,
} from '../constants/method-aadhaar';
import { assertDependency } from '../formats/guards';
import type { AadhaarCoreSurface, AadhaarPcd, AnonAadhaarArtifacts, AnonAadhaarStack } from '../types/method-aadhaar';
import { isRecord } from './inputs';

/** Thrown when the default stack cannot be loaded or initialised. */
export class AadhaarStackUnavailable extends Error {}

/** The loaded peer with the three time calls present, the shape `signedAt` reads. */
type AadhaarTimeSurface = AadhaarCoreSurface & Required<Pick<AadhaarCoreSurface, (typeof METHOD_AADHAAR_STACK_TIME_CALLS)[number]>>;

function isLoaded(value: unknown): value is AadhaarCoreSurface {
  try {
    assertDependency(value, METHOD_AADHAAR_STACK_CALLS, METHOD_AADHAAR_STACK_PACKAGE);
  } catch {
    return false;
  }

  return (
    isRecord(value) &&
    isRecord(value[METHOD_AADHAAR_STACK_ORIGINS_MEMBER]) &&
    METHOD_AADHAAR_STACK_KEY_MEMBERS.every((member) => typeof value[member] === 'string')
  );
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

/**
 * Whether the proof may reach the peer's `verify` under the mode. Test mode exists only for the peer's test QR, so in it
 * any other key answers false. Outside it the device refuses only the test key; a key the peer does not know (UIDAI
 * rotates its certificate, the module's key admin follows with `setTrustedKeys`, the peer only with a release) reaches
 * the peer, whose throw `judge` reads as `not-judged`, leaving the proof to the chain. An unparsable key answers false.
 */
function signedByModeKey(core: AadhaarCoreSurface, pcd: AadhaarPcd, testMode: boolean): boolean {
  try {
    const signedByTestKey = BigInt(pcd.proof.pubkeyHash) === BigInt(core.testPublicKeyHash);

    return testMode === signedByTestKey;
  } catch {
    return false;
  }
}

/** Whether the loaded peer exposes the three time calls `signedAt` reads with. */
function readsTime(core: AadhaarCoreSurface): core is AadhaarTimeSurface {
  try {
    assertDependency(core, METHOD_AADHAAR_STACK_TIME_CALLS, METHOD_AADHAAR_STACK_PACKAGE);
  } catch {
    return false;
  }

  return true;
}

/** The QR's signing time read with the peer's helpers, imported without `init`; any failure or a peer without them is `undefined`. */
async function signedAtOf(qrData: string): Promise<bigint | undefined> {
  try {
    const core = await importCore();

    if (!readsTime(core)) return undefined;

    const bytes = core.convertBigIntToByteArray(BigInt(qrData));
    const raw = core.decompressByteArray(bytes);

    return BigInt(core.timestampToUTCUnix(raw));
  } catch {
    return undefined;
  }
}

/**
 * The default stack over the artifacts, loaded and initialised once on first use; a failed load rejects with `AadhaarStackUnavailable` and is retried on the next call.
 * Once loaded, `verify` answers false without calling the peer for a test-key proof outside test mode and for any
 * other key in it; outside test mode a key the peer does not know is left to the peer's throw, `not-judged`.
 * `signedAt` imports the peer without `init`, so it downloads no artifact; a peer without the three time calls still loads, and
 * `signedAt` answers undefined.
 */
export function coreStack(artifacts: AnonAadhaarArtifacts): AnonAadhaarStack {
  let loading: Promise<AadhaarCoreSurface> | undefined;

  const load = (): Promise<AadhaarCoreSurface> => {
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
    signedAt: signedAtOf,
    verify: async (pcd, testMode) => {
      const core = await load();
      const mode = testMode === true;

      return signedByModeKey(core, pcd, mode) && core.verify(pcd, mode);
    },
  };
}

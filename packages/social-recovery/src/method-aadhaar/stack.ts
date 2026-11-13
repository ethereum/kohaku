import {
  METHOD_AADHAAR_DOWNLOAD_STATES,
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
import {
  METHOD_AADHAAR_ARTIFACT_HASH_MESSAGE,
  METHOD_AADHAAR_BUCKET_SHA256,
  METHOD_AADHAAR_STACK_DOWNLOAD_MESSAGE,
} from '../constants/method-aadhaar-bucket';
import { assertDependency } from '../formats/guards';
import type {
  AadhaarCoreSurface,
  AadhaarLoadedPeer,
  AadhaarPcd,
  AadhaarProgress,
  AadhaarProverArgs,
  AnonAadhaarArtifacts,
  AnonAadhaarStack,
} from '../types/method-aadhaar';
import { pinnedArtifacts } from './artifacts';
import { isRecord } from './inputs';
import { underBinding } from './peer-binding';

/** Thrown when the default stack cannot be loaded or initialised, or fails while downloading the circuit's files. */
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

/** The imported peer and its `init` argument for the artifacts, the SDK's own bucket files checked; a failed fetch or check is the device's failure. */
async function loadPeer(artifacts: AnonAadhaarArtifacts): Promise<AadhaarLoadedPeer> {
  let core: AadhaarCoreSurface;

  try {
    core = await importCore();
  } catch (error) {
    if (error instanceof AadhaarStackUnavailable) throw error;

    throw new AadhaarStackUnavailable(`${METHOD_AADHAAR_STACK_PACKAGE} ${METHOD_AADHAAR_STACK_MISSING_MESSAGE}`);
  }

  const origin = core.ArtifactsOrigin[artifacts.artifactsOrigin];

  if (typeof origin !== 'number') throw new AadhaarStackUnavailable(METHOD_AADHAAR_STACK_ORIGIN_MESSAGE);

  const files = await pinnedArtifacts(artifacts, METHOD_AADHAAR_BUCKET_SHA256);

  if (files === undefined) throw new AadhaarStackUnavailable(METHOD_AADHAAR_ARTIFACT_HASH_MESSAGE);

  return { core, argument: { ...files, artifactsOrigin: origin } };
}

/** Calls the peer's `init` with a copy of the argument; a refused `init` is the device's failure, not the material's. */
async function initPeer({ core, argument }: AadhaarLoadedPeer): Promise<void> {
  try {
    await core.init({ ...argument });
  } catch (error) {
    throw new AadhaarStackUnavailable(METHOD_AADHAAR_STACK_INIT_MESSAGE, { cause: error });
  }
}

/**
 * Whether the proof may reach the peer's `verify` under the mode. Test mode exists only for the peer's test QR, so in it
 * any other key answers false. Outside it the device refuses only the test key; a key the peer does not know (UIDAI
 * rotates its certificate, the module's key admin follows with `setTrustedKeys`, the peer only with a release) reaches
 * the peer, whose throw the local verdict reads as `not-judged`, leaving the proof to the chain. An unparsable key answers false.
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

const isDownloadState = (state: unknown): boolean => (METHOD_AADHAAR_DOWNLOAD_STATES as readonly unknown[]).includes(state);

/**
 * The peer's proof, its every state recorded before it reaches the page's callback unchanged; a rejection whose last state is a
 * download is `AadhaarStackUnavailable`, any other rejection is the peer's own.
 */
async function proveRecorded(core: AadhaarCoreSurface, args: AadhaarProverArgs, onProgress?: AadhaarProgress): Promise<AadhaarPcd> {
  let last: string | undefined;

  try {
    return await core.prove(args, (state) => {
      last = state;
      onProgress?.(state);
    });
  } catch (error) {
    if (isDownloadState(last)) throw new AadhaarStackUnavailable(METHOD_AADHAAR_STACK_DOWNLOAD_MESSAGE, { cause: error });

    throw error;
  }
}

/**
 * The default stack over the artifacts, loaded once on first use; a failed load rejects with `AadhaarStackUnavailable` and is retried on the next call.
 * Loading fetches and checks the SDK's own bucket wasm and vkey first, and a proof that fails while the peer downloads also rejects with it.
 * The peer's `init` is page-global, so two stacks with different files on one page take turns on the peer: before a call that reads the files,
 * a stack whose files the peer does not hold waits until every call in flight under the files it holds has settled, then calls `init` with its
 * own; a proof whose signal aborts while it waits never reaches the peer, and a refused `init` rejects with `AadhaarStackUnavailable`.
 * Once loaded, `verify` answers false without calling the peer for a test-key proof outside test mode and for any other key in it;
 * outside test mode a key the peer does not know is left to the peer's throw, `not-judged`. `signedAt` imports the peer without `init`,
 * so it downloads no artifact; a peer without the three time calls still loads, and `signedAt` answers undefined.
 */
export function coreStack(artifacts: AnonAadhaarArtifacts): AnonAadhaarStack {
  let loading: Promise<AadhaarLoadedPeer> | undefined;

  const load = (): Promise<AadhaarLoadedPeer> => {
    loading ??= loadPeer(artifacts).catch((error: unknown) => {
      loading = undefined;

      throw error;
    });

    return loading;
  };
  const onPeer = async <T>(use: (core: AadhaarCoreSurface) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const loaded = await load();

    return underBinding(loaded.argument, () => initPeer(loaded), () => use(loaded.core), signal);
  };

  return {
    generateArgs: (options) => onPeer((core) => core.generateArgs({ ...options, fieldsToRevealArray: [...options.fieldsToRevealArray] })),
    prove: (args, onProgress, signal) => onPeer((core) => proveRecorded(core, args, onProgress), signal),
    signedAt: signedAtOf,
    verify: (pcd, testMode) =>
      onPeer(async (core) => {
        const mode = testMode === true;

        return signedByModeKey(core, pcd, mode) && core.verify(pcd, mode);
      }),
  };
}

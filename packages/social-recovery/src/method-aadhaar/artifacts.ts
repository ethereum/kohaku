import { sha256 } from 'viem';
import { METHOD_AADHAAR_BUCKET_CHUNKED } from '../constants/method-aadhaar-bucket';
import type { Hex } from '../interfaces';
import type { AadhaarArtifactHashes, AnonAadhaarArtifacts, PinnedHashes, PinnedPair } from '../types/method-aadhaar';

/** The page's one pair per bucket files and pinned hashes, in flight or checked; a failed load leaves no entry. */
const pairs = new Map<string, Promise<PinnedPair | undefined>>();

/** Whether the wasm and vkey URLs are the SDK's own bucket files, the only ones whose hashes this build pins. */
const namesBucketFiles = (artifacts: AnonAadhaarArtifacts): boolean =>
  artifacts.wasmURL === METHOD_AADHAAR_BUCKET_CHUNKED.wasmURL && artifacts.vkeyURL === METHOD_AADHAAR_BUCKET_CHUNKED.vkeyURL;

const pairKey = (artifacts: AnonAadhaarArtifacts, expected: PinnedHashes): string =>
  JSON.stringify([artifacts.wasmURL, artifacts.vkeyURL, expected.wasm.toLowerCase(), expected.vkey.toLowerCase()]);

/** The bytes at the URL where the fetch answers and their sha256 is `expected`, else `undefined`. */
async function verifiedBytes(url: string, expected: Hex): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    const response = await fetch(url);

    if (!response.ok) return undefined;

    const bytes = new Uint8Array(await response.arrayBuffer());

    return sha256(bytes) === expected.toLowerCase() ? bytes : undefined;
  } catch {
    return undefined;
  }
}

const objectUrl = (bytes: Uint8Array<ArrayBuffer>): string => URL.createObjectURL(new Blob([bytes]));

/** An object URL for each file, or `undefined` where one cannot be made, the wasm's then revoked. */
function objectUrls(wasm: Uint8Array<ArrayBuffer>, vkey: Uint8Array<ArrayBuffer>): PinnedPair | undefined {
  let wasmURL: string | undefined;

  try {
    wasmURL = objectUrl(wasm);

    return { wasmURL, vkeyURL: objectUrl(vkey) };
  } catch {
    if (wasmURL !== undefined) URL.revokeObjectURL(wasmURL);

    return undefined;
  }
}

/** The bucket's wasm and vkey fetched and checked against `expected`, or `undefined` where a fetch, a check or an object URL fails. */
async function verifiedPair(artifacts: AnonAadhaarArtifacts, expected: PinnedHashes): Promise<PinnedPair | undefined> {
  const [wasm, vkey] = await Promise.all([verifiedBytes(artifacts.wasmURL, expected.wasm), verifiedBytes(artifacts.vkeyURL, expected.vkey)]);

  return wasm === undefined || vkey === undefined ? undefined : objectUrls(wasm, vkey);
}

/** The page's pair for the files and hashes: the first load fetches, every later or concurrent one shares it, and a failure is forgotten. */
function sharedPair(artifacts: AnonAadhaarArtifacts, expected: PinnedHashes): Promise<PinnedPair | undefined> {
  const key = pairKey(artifacts, expected);
  const known = pairs.get(key);

  if (known !== undefined) return known;

  const forget = (): undefined => {
    pairs.delete(key);

    return undefined;
  };
  const pending = verifiedPair(artifacts, expected).then((pair) => pair ?? forget(), forget);

  pairs.set(key, pending);

  return pending;
}

/**
 * The artifacts to initialise the peer with: for the SDK's own bucket the wasm and vkey, checked against `expected` and held
 * in memory behind object URLs, with the zkey URL unchanged; any other artifacts unchanged and unfetched. `undefined` where a
 * bucket file fails its fetch or its check. The page holds one checked pair per bucket files and hashes, which every later load
 * reuses without a fetch and nothing revokes, since the peer's page-global `init` may still read it; a failed load keeps nothing
 * and revokes any object URL it made, so the next load retries.
 */
export async function pinnedArtifacts(
  artifacts: AnonAadhaarArtifacts,
  expected: Pick<AadhaarArtifactHashes, 'wasm' | 'vkey'>,
): Promise<AnonAadhaarArtifacts | undefined> {
  if (!namesBucketFiles(artifacts)) return artifacts;

  const pair = await sharedPair(artifacts, expected);

  return pair === undefined ? undefined : { ...artifacts, ...pair };
}

/** Forgets every pair without revoking it, so the next load fetches again as on a new page. */
export function forgetPinnedPairs(): void {
  pairs.clear();
}

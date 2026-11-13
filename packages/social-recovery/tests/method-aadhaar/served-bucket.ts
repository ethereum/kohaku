import { sha256 } from 'viem';
import { afterEach, beforeEach, expect, vi } from 'vitest';
import type { Hex } from '../../src/interfaces';

/** Synthetic wasm bytes the stubbed fetch serves for the bucket's wasm URL: a wasm header, nothing more. */
export const SERVED_WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

/** Synthetic vkey bytes the stubbed fetch serves for the bucket's vkey URL. */
export const SERVED_VKEY = new TextEncoder().encode('{"protocol":"groth16","curve":"bn128","nPublic":9}');

type BucketFile = { readonly METHOD_AADHAAR_BUCKET_SHA256: { readonly wasm: Hex; readonly zkey: Hex; readonly vkey: Hex } };

/**
 * The bucket constants module with the pinned wasm and vkey hashes replaced by the served bytes' own, for a `vi.mock`
 * factory, so the default stack loads in a test without the real files.
 */
export function withServedHashes<Module extends BucketFile>(original: Module): Module {
  const pinned = original.METHOD_AADHAAR_BUCKET_SHA256;

  return { ...original, METHOD_AADHAAR_BUCKET_SHA256: Object.freeze({ ...pinned, wasm: sha256(SERVED_WASM), vkey: sha256(SERVED_VKEY) }) };
}

type FetchInput = string | URL | Request;

const urlOf = (input: FetchInput): string => (input instanceof Request ? input.url : String(input));

/**
 * Stubs `fetch` for every test of the calling file: the bucket's wasm and vkey URLs answer the served bytes, a `blob:` URL
 * reaches the real fetch, and any other URL rejects as unreachable. Answers the URLs fetched in the current test.
 */
export function serveBucket(files: { readonly wasmURL: string; readonly vkeyURL: string }): { readonly fetched: string[] } {
  const fetched: string[] = [];
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    fetched.length = 0;
    vi.stubGlobal('fetch', (input: FetchInput): Promise<Response> => {
      const url = urlOf(input);

      if (url.startsWith('blob:')) return realFetch(input);

      fetched.push(url);

      if (url === files.wasmURL) return Promise.resolve(new Response(SERVED_WASM));

      if (url === files.vkeyURL) return Promise.resolve(new Response(SERVED_VKEY));

      return Promise.reject(new TypeError(`fetch failed: ${url} is not served in tests`));
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  return { fetched };
}

/** What the peer's `init` receives for a bucket record once its wasm and vkey are checked: object URLs for both, the zkey URL as given. */
export const servedInit = (record: { readonly zkeyURL: string }, artifactsOrigin: number): unknown => ({
  wasmURL: expect.stringMatching(/^blob:/),
  zkeyURL: record.zkeyURL,
  vkeyURL: expect.stringMatching(/^blob:/),
  artifactsOrigin,
});

import type { AnonAadhaarArtifacts } from '../types/method-aadhaar';

/** anon-aadhaar's public v2 bucket, the base of both bucket records; it answers cross-origin GET only, and an extension page needs it in its host permissions. */
export const METHOD_AADHAAR_BUCKET_URL = 'https://anon-aadhaar-artifacts.s3.eu-central-1.amazonaws.com/v2.0.0';
const METHOD_AADHAAR_BUCKET_FILES = { wasmURL: `${METHOD_AADHAAR_BUCKET_URL}/aadhaar-verifier.wasm`, vkeyURL: `${METHOD_AADHAAR_BUCKET_URL}/vkey.json` };

/**
 * The bucket in the peer's browser mode: the 10 MB wasm, then the zkey in ten gzip pieces (296 MB) the peer caches in the browser's storage under
 * their file names alone, so two chunked sources share one cache. Browser only: in Node the peer's storage error surfaces inside the prover and the
 * proof reads `material-rejected`, so a Node caller passes `METHOD_AADHAAR_BUCKET_SERVER` or `local` paths.
 */
export const METHOD_AADHAAR_BUCKET_CHUNKED: AnonAadhaarArtifacts = Object.freeze({
  ...METHOD_AADHAAR_BUCKET_FILES,
  zkeyURL: `${METHOD_AADHAAR_BUCKET_URL}/chunked_zkey`,
  artifactsOrigin: 'chunked',
});

/** The bucket fetched whole: the 10 MB wasm and the 612 MB zkey, which the peer downloads again on every proof. */
export const METHOD_AADHAAR_BUCKET_SERVER: AnonAadhaarArtifacts = Object.freeze({
  ...METHOD_AADHAAR_BUCKET_FILES,
  zkeyURL: `${METHOD_AADHAAR_BUCKET_URL}/circuit_final.zkey`,
  artifactsOrigin: 'server',
});

/** The artifacts `anonAadhaarMethod` proves with where its options name neither a stack nor artifacts. */
export const METHOD_AADHAAR_DEFAULT_ARTIFACTS = METHOD_AADHAAR_BUCKET_CHUNKED;

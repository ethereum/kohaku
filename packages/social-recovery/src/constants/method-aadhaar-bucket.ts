import type { AadhaarArtifactHashes, AnonAadhaarArtifacts } from '../types/method-aadhaar';

/** anon-aadhaar's public v2 bucket, the base of both bucket records; it answers cross-origin GET only, and an extension page needs it in its host permissions. */
export const METHOD_AADHAAR_BUCKET_URL = 'https://anon-aadhaar-artifacts.s3.eu-central-1.amazonaws.com/v2.0.0';
const METHOD_AADHAAR_BUCKET_FILES = { wasmURL: `${METHOD_AADHAAR_BUCKET_URL}/aadhaar-verifier.wasm`, vkeyURL: `${METHOD_AADHAAR_BUCKET_URL}/vkey.json` };

/**
 * The bucket in the peer's browser mode: the 10 MB wasm, then the zkey in ten gzip pieces (296 MB) the peer caches in the browser's storage under
 * their file names alone, so two chunked sources share one cache. Browser only: in Node the peer's storage error surfaces inside the prover and the
 * proof reads `material-rejected`, so a Node caller passes `METHOD_AADHAAR_BUCKET_SERVER` or `local` paths. The peer drops a piece's download error,
 * so a failed or corrupt piece still reads `material-rejected` and stays in the browser's storage under its file name until the site's data is
 * cleared, and the chunked source that last wrote a name is the one every chunked proof on the page reads.
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

/**
 * The sha256 of the bucket's three files. The default stack checks the wasm and the vkey before the peer reads them; the zkey's is
 * for a caller holding a whole copy of its own, and the SDK does not check it.
 */
export const METHOD_AADHAAR_BUCKET_SHA256: AadhaarArtifactHashes = Object.freeze({
  wasm: '0x4894923663fafda95beb70abca4112ea97a62058c9a46419a274f04236f10d4f',
  zkey: '0x0d443ea85279b0370b53202f5e768ca9098cfcb5bb14f8ca8323d2266822c492',
  vkey: '0x40f2ea24b56ffe2b6e6e3578053cbda15e773cb560697bac883a404077fcf177',
});

/** Why the default stack is unavailable: a bucket file failed its fetch or check, or the peer failed while downloading the circuit's files. */
export const METHOD_AADHAAR_ARTIFACT_HASH_MESSAGE = 'the bucket files could not be fetched and checked against their pinned sha256';
export const METHOD_AADHAAR_STACK_DOWNLOAD_MESSAGE = 'the stack failed while downloading the circuit files';

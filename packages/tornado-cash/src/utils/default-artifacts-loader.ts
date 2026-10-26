import { loadCircuitFiles } from './circuit-loader';

// Pinned to a commit rather than a branch head; the prover still checks both files
// against the hashes in ./artifacts-integrity before using them.
const TC_ARTIFACTS_BASE_URL = 'https://raw.githubusercontent.com/tornadocash/tornado-cli/378ddf8b8b92a4924037d7b64a94dbfd5a7dd6e8/build/circuits';
const TC_CIRCUIT_URL = `${TC_ARTIFACTS_BASE_URL}/tornado.json`;
const TC_PROVING_KEY_URL = `${TC_ARTIFACTS_BASE_URL}/tornadoProvingKey.bin`;


export const defaultArtifactsLoader = () => loadCircuitFiles(TC_CIRCUIT_URL, TC_PROVING_KEY_URL)

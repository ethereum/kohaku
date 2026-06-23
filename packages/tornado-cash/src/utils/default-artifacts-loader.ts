import { loadCircuitFiles } from './circuit-loader';

const TC_CIRCUIT_URL = 'https://raw.githubusercontent.com/tornadocash/tornado-cli/refs/heads/master/build/circuits/tornado.json';
const TC_PROVING_KEY_URL = 'https://raw.githubusercontent.com/tornadocash/tornado-cli/refs/heads/master/build/circuits/tornadoProvingKey.bin';


export const defaultArtifactsLoader = () => loadCircuitFiles(TC_CIRCUIT_URL, TC_PROVING_KEY_URL)
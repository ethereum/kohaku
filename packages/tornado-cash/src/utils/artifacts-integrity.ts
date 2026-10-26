import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { ITornadoArtifacts } from '../plugin/interfaces/protocol-params.interface';

// SHA-256 of tornadocash/tornado-cli@378ddf8b build/circuits/{tornado.json,tornadoProvingKey.bin}.
// The circuit JSON carries each template as JavaScript source that the witness generator
// compiles with `new Function`, so these pins are what keeps a tampered file from running
// code in the wallet. Proofs from the pinned key verify against the deployed Tornado verifier.
export const TORNADO_CIRCUIT_SHA256 = '3ddd61dbff09caeec82d8edde95c674a3c34f9e66b1fe9f2c8783e72fe536f98';
export const TORNADO_PROVING_KEY_SHA256 = '8e2d2f22beafb5a9666daebca57b13f8029c3656c65fcfbcc86e2418fa16a3af';

export class TornadoArtifactsIntegrityError extends Error {
  constructor(artifact: string, expected: string, actual: string) {
    super(`Tornado ${artifact} failed its integrity check: expected sha256 ${expected}, got ${actual}`);
    this.name = 'TornadoArtifactsIntegrityError';
  }
}

/**
 * Throws unless both artifacts are byte-for-byte the pinned ones. Runs on whatever an
 * `artifactsLoader` returns, so custom loaders and caches get the same check as the default.
 */
export function assertTornadoArtifacts({ circuitText, provingKey }: ITornadoArtifacts): void {
  const circuitHash = bytesToHex(sha256(new TextEncoder().encode(circuitText)));

  if (circuitHash !== TORNADO_CIRCUIT_SHA256) {
    throw new TornadoArtifactsIntegrityError('circuit (tornado.json)', TORNADO_CIRCUIT_SHA256, circuitHash);
  }

  const provingKeyHash = bytesToHex(sha256(new Uint8Array(provingKey)));

  if (provingKeyHash !== TORNADO_PROVING_KEY_SHA256) {
    throw new TornadoArtifactsIntegrityError('proving key', TORNADO_PROVING_KEY_SHA256, provingKeyHash);
  }
}

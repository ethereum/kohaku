import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TacitArtifacts, loadArtifacts, type ProverArtifacts, type VerifyingKey } from '../../src';
import { vkHash } from '../../src/prover/artifacts';
import type { Host } from '@kohaku-eth/plugins';

/**
 * The ceremony's proving files: from `TACIT_ARTIFACTS_DIR` (transact.wasm, transact_final.zkey, transact_vk.json)
 * when it is set, checked against the same pins, otherwise downloaded.
 */
export async function testArtifacts(host: Host): Promise<ProverArtifacts> {
  const dir = process.env['TACIT_ARTIFACTS_DIR'];

  if (!dir || !existsSync(join(dir, 'transact_final.zkey'))) return loadArtifacts(host.network);

  const wasm = new Uint8Array(readFileSync(join(dir, 'transact.wasm')));
  const zkey = new Uint8Array(readFileSync(join(dir, 'transact_final.zkey')));
  const vk = JSON.parse(readFileSync(join(dir, 'transact_vk.json'), 'utf8')) as VerifyingKey;
  const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

  if (sha(wasm) !== TacitArtifacts.wasm.sha256 || sha(zkey) !== TacitArtifacts.zkey.sha256 || vkHash(vk) !== TacitArtifacts.vk.hash) {
    throw new Error('TACIT_ARTIFACTS_DIR does not hold the ceremony files');
  }

  return { wasm, zkey, vk };
}

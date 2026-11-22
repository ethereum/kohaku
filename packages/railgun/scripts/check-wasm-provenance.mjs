import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const vendorDir = join(packageDir, 'vendor/wasm')
const provenance = JSON.parse(readFileSync(join(vendorDir, 'provenance.json'), 'utf8'))
const hash = (file) => createHash('sha256').update(readFileSync(join(vendorDir, file))).digest('hex')

if (provenance.crate !== 'kohaku-railgun-wasm' || provenance.profile !== 'release') {
  throw new Error('Railgun WASM provenance does not describe a release build')
}
if (!/^[0-9a-f]{40}$/.test(provenance.sourceBaseCommit) || !/^[0-9a-f]{64}$/.test(provenance.sourceTreeSha256)) {
  throw new Error('Railgun WASM provenance has an invalid source revision or tree digest')
}
for (const [file, expected] of [
  ['source.patch', provenance.sourcePatchSha256],
  ['node/kohaku_railgun_wasm.js', provenance.nodeBindingsSha256],
  ['node/kohaku_railgun_wasm.d.ts', provenance.nodeDeclarationsSha256],
  ['node/kohaku_railgun_wasm_bg.wasm.d.ts', provenance.nodeWasmDeclarationsSha256],
  ['node/kohaku_railgun_wasm_bg.wasm', provenance.nodeWasmSha256],
  ['web/kohaku_railgun_wasm.js', provenance.webBindingsSha256],
  ['web/kohaku_railgun_wasm.d.ts', provenance.webDeclarationsSha256],
  ['web/kohaku_railgun_wasm_bg.wasm.d.ts', provenance.webWasmDeclarationsSha256],
  ['web/kohaku_railgun_wasm_bg.wasm', provenance.webWasmSha256],
]) {
  if (!/^[0-9a-f]{64}$/.test(expected) || hash(file) !== expected) {
    throw new Error(`Railgun WASM provenance mismatch: ${file}`)
  }
}
if (JSON.parse(readFileSync(join(vendorDir, 'node/package.json'), 'utf8')).type !== 'commonjs') {
  throw new Error('Node wasm-bindgen output must be loaded as CommonJS')
}
if (provenance.sourceDirty !== (readFileSync(join(vendorDir, 'source.patch'), 'utf8').length > 0)) {
  throw new Error('Railgun source patch flag does not match source.patch')
}
console.log(`Verified Railgun WASM from ${provenance.sourceBaseCommit.slice(0, 12)}`)

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)))
const sourceDir = resolve(process.env.KOHAKU_RS_DIR ?? join(packageDir, '../../../kohaku-rs'))
const cratesDir = join(sourceDir, 'crates')
const vendorDir = join(packageDir, 'vendor/wasm')
const bindgen = process.env.WASM_BINDGEN_BIN ?? 'wasm-bindgen'

function run(command, args, cwd = sourceDir, stdio = 'inherit') {
  const result = spawnSync(command, args, { cwd, stdio, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}: ${result.stderr ?? ''}`)
  return result.stdout ?? ''
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sourceTreeHash() {
  const files = run('git', ['ls-files', '-co', '--exclude-standard', '--', 'crates'], sourceDir, 'pipe')
    .split('\n').filter(Boolean).filter((file) => !file.startsWith('crates/target/')).sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file).update('\0').update(readFileSync(join(sourceDir, file))).update('\0')
  }
  return hash.digest('hex')
}

if (!existsSync(join(cratesDir, 'Cargo.lock'))) {
  throw new Error(`Set KOHAKU_RS_DIR to a kohaku-rs checkout: ${sourceDir}`)
}
const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '--', 'crates'], sourceDir, 'pipe').trim()
if (untracked) throw new Error(`Track new Rust source files before rebuilding: ${untracked}`)

const lock = readFileSync(join(cratesDir, 'Cargo.lock'), 'utf8')
const bindgenVersion = lock.match(/name = "wasm-bindgen"\nversion = "([^"]+)"/)?.[1]
if (!bindgenVersion) throw new Error('Could not find wasm-bindgen in Cargo.lock')
const installedBindgenVersion = run(bindgen, ['--version'], sourceDir, 'pipe').trim()
if (installedBindgenVersion !== `wasm-bindgen ${bindgenVersion}`) {
  throw new Error(`Expected wasm-bindgen ${bindgenVersion}, found ${installedBindgenVersion}`)
}

const sourceBaseCommit = run('git', ['rev-parse', 'HEAD'], sourceDir, 'pipe').trim()
const sourcePatch = run('git', ['diff', '--binary', 'HEAD', '--', 'crates'], sourceDir, 'pipe')
const sourceTreeSha256 = sourceTreeHash()
const artifact = join(cratesDir, 'target/wasm32-unknown-unknown/release/kohaku_railgun_wasm.wasm')
mkdirSync(vendorDir, { recursive: true })
run('cargo', [
  'build', '--locked', '--release', '--manifest-path', join(cratesDir, 'Cargo.toml'),
  '-p', 'kohaku-railgun-wasm', '--target', 'wasm32-unknown-unknown',
  '--target-dir', join(cratesDir, 'target'),
])
for (const [target, dir] of [['nodejs', 'node'], ['web', 'web']]) {
  run(bindgen, [artifact, '--target', target, '--out-dir', join(vendorDir, dir)])
}
writeFileSync(join(vendorDir, 'node/package.json'), '{"type":"commonjs"}\n')
writeFileSync(join(vendorDir, 'source.patch'), sourcePatch)

const fileHash = (file) => sha256(readFileSync(join(vendorDir, file)))
const provenance = {
  sourceRepository: 'https://github.com/ethereum/kohaku-rs',
  sourceBaseCommit,
  sourceDirty: sourcePatch.length > 0,
  sourcePatchSha256: sha256(sourcePatch),
  sourceTreeSha256,
  crate: 'kohaku-railgun-wasm',
  target: 'wasm32-unknown-unknown',
  profile: 'release',
  wasmBindgenVersion: installedBindgenVersion,
  nodeBindingsSha256: fileHash('node/kohaku_railgun_wasm.js'),
  nodeDeclarationsSha256: fileHash('node/kohaku_railgun_wasm.d.ts'),
  nodeWasmDeclarationsSha256: fileHash('node/kohaku_railgun_wasm_bg.wasm.d.ts'),
  nodeWasmSha256: fileHash('node/kohaku_railgun_wasm_bg.wasm'),
  webBindingsSha256: fileHash('web/kohaku_railgun_wasm.js'),
  webDeclarationsSha256: fileHash('web/kohaku_railgun_wasm.d.ts'),
  webWasmDeclarationsSha256: fileHash('web/kohaku_railgun_wasm_bg.wasm.d.ts'),
  webWasmSha256: fileHash('web/kohaku_railgun_wasm_bg.wasm'),
}
writeFileSync(join(vendorDir, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`)
console.log(`Built Railgun WASM from ${sourceBaseCommit}${provenance.sourceDirty ? ' plus source.patch' : ''}`)

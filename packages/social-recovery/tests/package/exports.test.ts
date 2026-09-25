import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT, REPO_ROOT } from '../helpers/source';

type ExportTarget = { readonly types?: string; readonly import?: string };

type Manifest = {
  readonly name?: string;
  readonly version?: string;
  readonly type?: string;
  readonly main?: string;
  readonly module?: string;
  readonly types?: string;
  readonly exports?: Readonly<Record<string, ExportTarget | string>>;
  readonly files?: readonly string[];
  readonly sideEffects?: boolean;
  readonly license?: string;
  readonly publishConfig?: { readonly access?: string };
  readonly repository?: { readonly directory?: string };
  readonly engines?: { readonly node?: string };
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>;
};

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as Manifest;

const OPTIONAL_PEERS = ['@zkpassport/sdk', '@anon-aadhaar/core'];

describe('package.json', () => {
  it('names the one package @kohaku-eth/social-recovery at version 0.0.1', () => {
    expect(manifest.name).toBe('@kohaku-eth/social-recovery');
    expect(manifest.version).toBe('0.0.1');
  });

  it('is an ES module', () => {
    expect(manifest.type).toBe('module');
  });

  it('maps exactly the core entry, the recovery-methods entry and package.json', () => {
    expect(Object.keys(manifest.exports ?? {}).sort()).toEqual(['.', './package.json', './recovery-methods']);
  });

  it.each([
    ['.', 'index'],
    ['./recovery-methods', 'recovery-methods'],
  ])('points %s at the built %s entry and its declarations', (subpath, file) => {
    const target = manifest.exports?.[subpath];

    expect(target).toMatchObject({ types: `./dist/${file}.d.ts`, import: `./dist/${file}.js` });
  });

  it('exports ./package.json as itself', () => {
    expect(manifest.exports?.['./package.json']).toBe('./package.json');
  });

  it('points main, module and types under dist/', () => {
    expect([manifest.main, manifest.module, manifest.types]).toEqual([
      './dist/index.js',
      './dist/index.js',
      './dist/index.d.ts',
    ]);
  });

  it('publishes dist alone, free of side effects', () => {
    expect(manifest.files).toEqual(['dist']);
    expect(manifest.sideEffects).toBe(false);
  });

  it('follows the partner conventions for publishing, licence, repository and engine', () => {
    expect(manifest.publishConfig?.access).toBe('public');
    expect(manifest.license).toBe('MIT');
    expect(manifest.repository?.directory).toBe('packages/social-recovery');
    expect(manifest.engines?.node).toBe('>=22');
  });

  it('runs the partner scripts: tsup build and watch, vitest run, eslint', () => {
    const scripts = manifest.scripts ?? {};

    expect(scripts['build']).toMatch(/\btsup\b/);
    expect(scripts['dev']).toMatch(/\btsup\b.*--watch/);
    expect(scripts['test']).toBe('vitest run');
    expect(scripts['lint']).toBe('eslint .');
    expect(scripts['lint:fix']).toBe('eslint . --fix');
  });

  it.each(OPTIONAL_PEERS)('declares %s as an optional peer dependency', (peer) => {
    expect(manifest.peerDependencies?.[peer]).toEqual(expect.any(String));
    expect(manifest.peerDependenciesMeta?.[peer]?.optional).toBe(true);
    expect(manifest.dependencies?.[peer]).toBeUndefined();
  });

  it('declares no runtime dependency beyond viem and ox, which enter only where a declaration needs them', () => {
    const extra = Object.keys(manifest.dependencies ?? {}).filter((name) => !['viem', 'ox'].includes(name));

    expect(extra).toEqual([]);
  });

  it.each(['tsup', 'vitest', 'typescript', 'fast-check', '@types/node'])(
    'declares %s as a devDependency',
    (name) => {
      expect(manifest.devDependencies?.[name]).toEqual(expect.any(String));
    },
  );
});

describe('pnpm-workspace.yaml at the repository root', () => {
  it('lists packages/social-recovery once among the workspace packages', () => {
    const lines = readFileSync(join(REPO_ROOT, 'pnpm-workspace.yaml'), 'utf8').split('\n');
    const start = lines.findIndex((line) => line.trimEnd() === 'packages:');
    const packages: string[] = [];

    expect(start).toBeGreaterThanOrEqual(0);

    for (const line of lines.slice(start + 1)) {
      const entry = /^\s+-\s+["']?([^"'\s]+)["']?\s*$/.exec(line);

      if (entry === null) break;

      packages.push(entry[1] ?? '');
    }

    expect(packages.filter((entry) => entry === 'packages/social-recovery')).toHaveLength(1);
  });
});

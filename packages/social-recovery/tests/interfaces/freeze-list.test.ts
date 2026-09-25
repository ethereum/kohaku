import { join } from 'node:path';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createSourceProgram,
  findInterfaces,
  hasModifier,
  type InterfaceSite,
  listSourceFiles,
  requireSourceFile,
  resolveExports,
  SRC_ROOT,
  toPackagePath,
  walk,
} from '../helpers/source';

/** The interfaces the SDK freezes, listed independently of src/. */
const FREEZE_LIST = [
  'ISetupClient',
  'IRecoveryClient',
  'IMethodsOrchestrator',
  'IPolicyManagerInteractor',
  'IEventManager',
  'IMethodModuleReads',
  'IProvider',
  'IRecoveryMethod',
  'IActionCodec',
  'IMethodCodec',
  'IRecoveryActionInteractor',
  'IRecoveryActionArming',
] as const;

/** The shipped implementations' names, which no type or interface may take. */
const SHIPPED_IMPLEMENTATIONS = [
  'SetupClient',
  'RecoveryClient',
  'MethodsOrchestrator',
  'PolicyManager',
  'EventManager',
  'AmbireRecoveryAction',
  'AmbireActionCodec',
  'WalletMethod',
  'PasskeyMethod',
  'ZkPassportMethod',
  'AnonAadhaarMethod',
  'RecoveryKitBuilder',
];

const sorted = (names: readonly string[]): string[] => [...names].sort();

let program: ts.Program;
let checker: ts.TypeChecker;
let sites: InterfaceSite[];

beforeAll(() => {
  program = createSourceProgram();
  checker = program.getTypeChecker();
  sites = findInterfaces(program);
});

const sitesNamed = (name: string): InterfaceSite[] => sites.filter((site) => site.name === name);

describe('the freeze list', () => {
  it('names twelve distinct interfaces', () => {
    expect(new Set(FREEZE_LIST).size).toBe(12);
  });

  it('carries the I prefix on every name and the Interactor suffix on the two contract interactors', () => {
    for (const name of FREEZE_LIST) expect(name).toMatch(/^I[A-Z]/);

    expect(FREEZE_LIST.filter((name) => name.endsWith('Interactor'))).toEqual([
      'IPolicyManagerInteractor',
      'IRecoveryActionInteractor',
    ]);
  });
});

describe('interface declarations under src/interfaces/', () => {
  it('are exactly the twelve names of the freeze list', () => {
    const declared = sites.filter((site) => site.file.startsWith('src/interfaces/')).map((site) => site.name);

    expect(sorted(declared)).toEqual(sorted(FREEZE_LIST));
  });

  it.each(FREEZE_LIST)('declares %s exactly once', (name) => {
    expect(sitesNamed(name).map((site) => site.file)).toHaveLength(1);
  });

  it.each(FREEZE_LIST)('exports %s from the file that declares it', (name) => {
    for (const site of sitesNamed(name)) {
      expect(hasModifier(site.node, ts.SyntaxKind.ExportKeyword), `${name} in ${site.file}`).toBe(true);

      const exported = resolveExports(checker, site.node.getSourceFile()).get(name);

      expect(exported?.declarations?.includes(site.node), `${name} in ${site.file}`).toBe(true);
    }

    expect(sitesNamed(name).length).toBeGreaterThan(0);
  });

  it.each(FREEZE_LIST)('declares %s at the top level of its module, not nested in a block', (name) => {
    for (const site of sitesNamed(name)) expect(site.node.parent.kind).toBe(ts.SyntaxKind.SourceFile);
  });
});

describe('interface declarations anywhere under src/', () => {
  it('finds source files to judge', () => {
    expect(listSourceFiles(SRC_ROOT).length).toBeGreaterThan(0);
  });

  it('declare nothing outside the freeze list with the interface keyword', () => {
    const extra = sites
      .filter((site) => !(FREEZE_LIST as readonly string[]).includes(site.name))
      .map((site) => `${site.file}: interface ${site.name}`);

    expect(extra).toEqual([]);
  });

  it('declare every interface under src/interfaces/', () => {
    const outside = sites
      .filter((site) => !site.file.startsWith('src/interfaces/'))
      .map((site) => `${site.file}: interface ${site.name}`);

    expect(outside).toEqual([]);
  });

  it('leave each bare name to the shipped implementation, never to a type or an interface', () => {
    const reserved = new Set([...FREEZE_LIST.map((name) => name.slice(1)), ...SHIPPED_IMPLEMENTATIONS]);
    const taken: string[] = [];

    for (const path of listSourceFiles(SRC_ROOT)) {
      walk(requireSourceFile(program, path), (node) => {
        const isTypeDeclaration = ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node);

        if (isTypeDeclaration && reserved.has(node.name.text)) {
          taken.push(`${toPackagePath(path)}: ${node.name.text}`);
        }
      });
    }

    expect(taken).toEqual([]);
  });
});

describe('the package entries', () => {
  const entryExports = (relativePath: string): Map<string, ts.Symbol> =>
    resolveExports(checker, requireSourceFile(program, join(SRC_ROOT, relativePath)));

  it.each(FREEZE_LIST)('the core entry src/index.ts exports %s as the declared interface, a type only', (name) => {
    const exported = entryExports('index.ts').get(name);
    const [site] = sitesNamed(name);

    expect(exported, `${name} is not exported from src/index.ts`).toBeDefined();
    expect(site, `${name} is not declared`).toBeDefined();
    expect(site !== undefined && exported?.declarations?.includes(site.node)).toBe(true);
    expect((exported?.flags ?? 0) & ts.SymbolFlags.Interface).not.toBe(0);
    expect((exported?.flags ?? 0) & ts.SymbolFlags.Value).toBe(0);
  });

  it('the recovery-methods entry re-exports IMethodsOrchestrator as the declared interface', () => {
    const exported = entryExports('recovery-methods/index.ts').get('IMethodsOrchestrator');
    const [site] = sitesNamed('IMethodsOrchestrator');

    expect(exported, 'IMethodsOrchestrator is not exported from src/recovery-methods/index.ts').toBeDefined();
    expect(site !== undefined && exported?.declarations?.includes(site.node)).toBe(true);
  });
});

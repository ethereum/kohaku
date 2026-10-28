import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PACKAGE_ROOT } from '../helpers/source';

const CONSUMER = join(PACKAGE_ROOT, 'tests', 'builder', 'consumer.virtual.ts');
const BUILT_ENTRY = join(PACKAGE_ROOT, 'dist', 'index.d.ts');

const HOLDER_ONLY = ['build', 'buildSetupClient', 'buildRecoveryClient', 'recoveryAction', 'methodModuleReads'] as const;

const options = (): ts.CompilerOptions => {
  const read = ts.readConfigFile(join(PACKAGE_ROOT, 'tsconfig.json'), (path) => ts.sys.readFile(path));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, PACKAGE_ROOT);

  return { ...parsed.options, noEmit: true, declaration: false, declarationMap: false, sourceMap: false };
};

/** One consumer statement per line, so a diagnostic's line names the call it is about. */
function consumerSource(entry: string, lines: readonly string[]): string {
  return [
    `import { SocialRecoveryBuilder } from '${entry}';`,
    `const holderBuilder = SocialRecoveryBuilder.from({ provider: {} as never, account: '0x0000000000000000000000000000000000000001' });`,
    `const byChain = SocialRecoveryBuilder.from({ chainId: 1 });`,
    `const byDescriptor = SocialRecoveryBuilder.from({ descriptor: {} as never });`,
    ...lines,
    'export {};',
  ].join('\n');
}

const PREAMBLE_LINES = 4;

/** The diagnostics a consumer file raises, keyed by the zero-based index of the statement line they fall on. */
function diagnosticsOf(entry: string, lines: readonly string[]): { readonly byLine: Map<number, readonly ts.Diagnostic[]>; readonly program: ts.Program } {
  const compilerOptions = options();
  const host = ts.createCompilerHost(compilerOptions, true);
  const text = consumerSource(entry, lines);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);

  host.getSourceFile = (fileName, languageVersion, ...rest) =>
    fileName === CONSUMER ? ts.createSourceFile(fileName, text, languageVersion, true) : getSourceFile(fileName, languageVersion, ...rest);
  host.fileExists = (fileName) => fileName === CONSUMER || fileExists(fileName);
  host.readFile = (fileName) => (fileName === CONSUMER ? text : readFile(fileName));

  const program = ts.createProgram({ rootNames: [CONSUMER], options: compilerOptions, host });
  const file = program.getSourceFile(CONSUMER)!;
  const byLine = new Map<number, ts.Diagnostic[]>();

  for (const diagnostic of [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file)]) {
    const line = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line - PREAMBLE_LINES;

    byLine.set(line, [...(byLine.get(line) ?? []), diagnostic]);
  }

  return { byLine, program };
}

const message = (diagnostic: ts.Diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');

const APPROVER_CALLS = [
  ...HOLDER_ONLY.flatMap((name) => [`void byChain.${name}();`, `void byDescriptor.${name}();`]),
  'const annotatedApprover: SocialRecoveryBuilder = SocialRecoveryBuilder.from({ chainId: 1 }); void annotatedApprover;',
];
const ALLOWED_CALLS = [
  ...HOLDER_ONLY.map((name) => `void holderBuilder.${name}();`),
  'void holderBuilder.buildMethodsOrchestrator();',
  'void byChain.buildMethodsOrchestrator();',
  'void byDescriptor.buildMethodsOrchestrator();',
  'void SocialRecoveryBuilder.build({ provider: {} as never, account: \'0x0000000000000000000000000000000000000001\' });',
  'const annotatedHolder: SocialRecoveryBuilder = SocialRecoveryBuilder.from({ provider: {} as never, account: \'0x0000000000000000000000000000000000000001\' }); void annotatedHolder.build();',
];

describe.each([
  ['the built declaration', '../../dist/index'],
  ['the source entry', '../../src/index'],
])('a consumer compiled against %s', (_label, entry) => {
  it(
    'gets one diagnostic per holder-only call on an approver builder, and on an approver annotated as the default builder, and none on the allowed calls',
    () => {
      const { byLine, program } = diagnosticsOf(entry, [...APPROVER_CALLS, ...ALLOWED_CALLS]);

      if (entry.includes('dist')) expect(program.getSourceFile(BUILT_ENTRY), 'dist/index.d.ts is missing: build the package first').toBeDefined();

      APPROVER_CALLS.forEach((call, line) => {
        expect(byLine.get(line)?.length, call).toBeGreaterThan(0);
      });

      ALLOWED_CALLS.forEach((call, place) => {
        expect(byLine.get(APPROVER_CALLS.length + place)?.map(message) ?? [], call).toEqual([]);
      });

      for (let line = -PREAMBLE_LINES; line < 0; line += 1) expect((byLine.get(line) ?? []).map(message), `preamble line ${line}`).toEqual([]);
    },
    60_000,
  );
});

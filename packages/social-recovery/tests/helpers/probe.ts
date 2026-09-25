import { join } from 'node:path';
import ts from 'typescript';
import { listSourceFiles, PACKAGE_ROOT, SRC_ROOT } from './source';

/** Where the probes live, so `../../src/index` resolves from them. */
const PROBE_DIR = join(PACKAGE_ROOT, 'tests', 'records');

/** The import line every probe starts with. */
export const PROBE_IMPORT_FROM = '../../src/index';

function packageOptions(): ts.CompilerOptions {
  const configPath = join(PACKAGE_ROOT, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));

  if (config.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  }

  return { ...ts.parseJsonConfigFileContent(config.config, ts.sys, PACKAGE_ROOT).options, noEmit: true };
}

/**
 * Compiles every probe against `src/` under the package's compiler options, so `vitest run` judges what callers may write.
 * Returns each probe's own errors as `TS<code>: <message>`; an empty list means it compiles.
 */
export function compileProbes(probes: Readonly<Record<string, string>>): Map<string, string[]> {
  const options = packageOptions();
  const files = new Map(Object.entries(probes).map(([name, text]) => [join(PROBE_DIR, `probe-${name}.ts`), text]));
  const host = ts.createCompilerHost(options, true);
  const baseGetSourceFile = host.getSourceFile.bind(host);

  host.getSourceFile = (name, languageVersion, onError, shouldCreate) => {
    const text = files.get(name);

    return text !== undefined
      ? ts.createSourceFile(name, text, languageVersion, true)
      : baseGetSourceFile(name, languageVersion, onError, shouldCreate);
  };
  host.fileExists = (name) => files.has(name) || ts.sys.fileExists(name);
  host.readFile = (name) => files.get(name) ?? ts.sys.readFile(name);

  const program = ts.createProgram([...listSourceFiles(SRC_ROOT), ...files.keys()], options, host);
  const results = new Map<string, string[]>();

  for (const [path] of files) {
    const sourceFile = program.getSourceFile(path);

    if (sourceFile === undefined) throw new Error(`probe not in its program: ${path}`);

    const diagnostics = [...program.getSyntacticDiagnostics(sourceFile), ...program.getSemanticDiagnostics(sourceFile)];
    const name = path.slice(join(PROBE_DIR, 'probe-').length, -'.ts'.length);

    results.set(
      name,
      diagnostics.map((diagnostic) => `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`),
    );
  }

  return results;
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types (must match run.ts JSON output)
// ---------------------------------------------------------------------------

interface BenchmarkResultJson {
  metadata: {
    timestamp: string;
    suite: string;
    provider: string;
    execution?: string;
    consensus?: string;
    prover?: string;
    checkpoint_interval?: number;
  };
  sync_time_ms: number;
  methods: Record<
    string,
    {
      success_result: { avg_ms: number | null; n: number; traffic_bytes?: number };
      success_no_result: { avg_ms: number | null; n: number; traffic_bytes?: number };
      failure: { avg_ms: number | null; n: number; traffic_bytes?: number };
    }
  >;
  failed_requests: Array<{ method: string; error: string }>;
  /** New format: sync_bytes, request_bytes, background_bytes. Legacy: total_bytes, request_bytes, background_bytes (sync_bytes treated as 0). */
  traffic?: {
    sync_bytes?: number;
    request_bytes: number;
    background_bytes: number;
    total_bytes?: number;
  };
  process_usage?: {
    user_cpu_us: number;
    system_cpu_us: number;
    wall_ms: number;
    cpu_percent: number;
  };
}

type OutcomeKey = 'success_result' | 'success_no_result' | 'failure';
const OUTCOMES: OutcomeKey[] = ['success_result', 'success_no_result', 'failure'];

type ProviderKey = 'rpc' | 'helios' | 'colibri';
const PROVIDERS: ProviderKey[] = ['rpc', 'helios', 'colibri'];

/** Per (method, outcome): best avg_ms, n, and optional traffic_bytes for each provider. */
type BestCell = { avg_ms: number; n: number; traffic_bytes?: number } | null;

// ---------------------------------------------------------------------------
// Load and aggregate
// ---------------------------------------------------------------------------

function loadResultFiles(resultsDir: string): BenchmarkResultJson[] {
  const files = fs.readdirSync(resultsDir, { withFileTypes: true });
  const out: BenchmarkResultJson[] = [];
  for (const e of files) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    const filePath = path.join(resultsDir, e.name);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as BenchmarkResultJson;
      if (data.metadata?.provider && data.methods) out.push(data);
    } catch {
      // Skip invalid or legacy files
    }
  }
  return out;
}

/** For each provider, pick best (lowest) avg_ms per (method, outcome) across runs. */
function buildBestPerProvider(
  runs: BenchmarkResultJson[],
): Map<ProviderKey, Map<string, Record<OutcomeKey, BestCell>>> {
  const byProvider = new Map<ProviderKey, BenchmarkResultJson[]>();
  for (const run of runs) {
    const p = run.metadata.provider as ProviderKey;
    if (!PROVIDERS.includes(p)) continue;
    const list = byProvider.get(p) ?? [];
    list.push(run);
    byProvider.set(p, list);
  }

  const best = new Map<ProviderKey, Map<string, Record<OutcomeKey, BestCell>>>();

  for (const provider of PROVIDERS) {
    const list = byProvider.get(provider) ?? [];
    const methodMap = new Map<string, Record<OutcomeKey, BestCell>>();

    for (const run of list) {
      for (const [method, row] of Object.entries(run.methods)) {
        let rec = methodMap.get(method);
        if (!rec) {
          rec = { success_result: null, success_no_result: null, failure: null };
          methodMap.set(method, rec);
        }
        for (const outcome of OUTCOMES) {
          const cell = row[outcome];
          if (cell.n === 0) continue;
          const avg_ms = typeof cell.avg_ms === 'number' ? cell.avg_ms : null;
          if (avg_ms == null) continue;
          const current = rec[outcome];
          const traffic_bytes = (cell as { traffic_bytes?: number }).traffic_bytes;
          if (!current || avg_ms < current.avg_ms) {
            rec[outcome] = { avg_ms, n: cell.n, ...(traffic_bytes != null && { traffic_bytes }) };
          }
        }
      }
    }
    best.set(provider, methodMap);
  }
  return best;
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)} ms`;
}

type SyncEntry = { ms: number; sync_bytes?: number; background_bytes?: number };

/** Best sync time per provider (and per helios checkpoint); includes traffic from that run when available. */
function buildSyncTimes(
  runs: BenchmarkResultJson[],
): { rpc: SyncEntry | null; helios: Map<number, SyncEntry>; colibri: SyncEntry | null } {
  const rpcRuns = runs.filter((r) => r.metadata.provider === 'rpc');
  const heliosRuns = runs.filter((r) => r.metadata.provider === 'helios');
  const colibriRuns = runs.filter((r) => r.metadata.provider === 'colibri');

  const pick = (run: BenchmarkResultJson): SyncEntry => {
    const ms = run.sync_time_ms;
    const t = run.traffic;
    if (!t) return { ms };
    const sync_bytes = typeof t.sync_bytes === 'number' ? t.sync_bytes : undefined;
    return { ms, sync_bytes, background_bytes: t.background_bytes };
  };

  const withTrafficFrom = (best: SyncEntry, runs: BenchmarkResultJson[]): SyncEntry => {
    if (best.sync_bytes !== undefined) return best;
    const withTraffic = runs.find((r) => r.traffic && typeof r.traffic.sync_bytes === 'number');
    if (!withTraffic?.traffic) return best;
    return {
      ms: best.ms,
      sync_bytes: withTraffic.traffic.sync_bytes,
      background_bytes: withTraffic.traffic.background_bytes,
    };
  };

  let rpc: SyncEntry | null = null;
  for (const r of rpcRuns) {
    if (rpc === null || r.sync_time_ms < rpc.ms) rpc = pick(r);
  }
  if (rpc) rpc = withTrafficFrom(rpc, rpcRuns);

  let colibri: SyncEntry | null = null;
  for (const r of colibriRuns) {
    if (colibri === null || r.sync_time_ms < colibri.ms) colibri = pick(r);
  }
  if (colibri) colibri = withTrafficFrom(colibri, colibriRuns);

  const heliosByInterval = new Map<number, SyncEntry>();
  for (const r of heliosRuns) {
    const interval = r.metadata.checkpoint_interval ?? 1;
    const current = heliosByInterval.get(interval);
    if (current === undefined || r.sync_time_ms < current.ms) {
      heliosByInterval.set(interval, pick(r));
    }
  }
  for (const [interval, e] of heliosByInterval) {
    const runsForInterval = heliosRuns.filter((r) => (r.metadata.checkpoint_interval ?? 1) === interval);
    heliosByInterval.set(interval, withTrafficFrom(e, runsForInterval));
  }
  return { rpc, helios: heliosByInterval, colibri };
}

function formatBytes(b: number): string {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${b} B`;
}

/** Per provider: one run's traffic (sync, request, background) for display. Normalizes legacy JSON (no sync_bytes). */
function buildTrafficSummary(
  runs: BenchmarkResultJson[],
): Map<ProviderKey, { sync_bytes: number; request_bytes: number; background_bytes: number }> {
  const out = new Map<ProviderKey, { sync_bytes: number; request_bytes: number; background_bytes: number }>();
  for (const run of runs) {
    const t = run.traffic;
    if (!t) continue;
    const p = run.metadata.provider as ProviderKey;
    if (!PROVIDERS.includes(p)) continue;
    const sync_bytes = typeof t.sync_bytes === 'number' ? t.sync_bytes : 0;
    out.set(p, { sync_bytes, request_bytes: t.request_bytes, background_bytes: t.background_bytes });
  }
  return out;
}

type ProcessUsageEntry = {
  user_cpu_us: number;
  system_cpu_us: number;
  wall_ms: number;
  cpu_percent: number;
};

/** Process usage from the run with best sync time among runs that have process_usage, per provider. */
function buildProcessUsageTable(
  runs: BenchmarkResultJson[],
): { rpc: ProcessUsageEntry | null; helios: Map<number, ProcessUsageEntry>; colibri: ProcessUsageEntry | null } {
  const withUsage = (list: BenchmarkResultJson[]): BenchmarkResultJson | null => {
    const withPu = list.filter((r) => r.process_usage);
    if (withPu.length === 0) return null;
    return withPu.reduce((a, b) => (a.sync_time_ms <= b.sync_time_ms ? a : b));
  };

  const rpcRuns = runs.filter((r) => r.metadata.provider === 'rpc');
  const heliosRuns = runs.filter((r) => r.metadata.provider === 'helios');
  const colibriRuns = runs.filter((r) => r.metadata.provider === 'colibri');

  const rpc = withUsage(rpcRuns)?.process_usage ?? null;
  const colibri = withUsage(colibriRuns)?.process_usage ?? null;

  const heliosByInterval = new Map<number, ProcessUsageEntry>();
  for (const interval of [...new Set(heliosRuns.map((r) => r.metadata.checkpoint_interval ?? 1))]) {
    const best = withUsage(heliosRuns.filter((r) => (r.metadata.checkpoint_interval ?? 1) === interval));
    if (best?.process_usage) heliosByInterval.set(interval, best.process_usage);
  }

  return { rpc, helios: heliosByInterval, colibri };
}

function formatWallMs(ms: number): string {
  const sec = ms / 1000;
  if (sec >= 60) return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  return `${sec.toFixed(1)}s`;
}

/** Time always in ms; use period as thousands separator when >= 1000 (e.g. "2.700 ms", "1.023.592 ms"). */
function formatMsUniform(ms: number): string {
  const n = Math.round(ms);
  if (n < 1000) return `${n} ms`;
  const s = n.toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += '.';
    out += s[i];
  }
  return `${out} ms`;
}

/** One row in the combined metrics table: metric name and per-provider cell(s). Helios is an array (one line per interval). */
type MetricsRow = { metric: string; rpc: string; helios: string[]; colibri: string };

function printMetricsOverview(
  syncTimes: ReturnType<typeof buildSyncTimes>,
  trafficByProvider: Map<ProviderKey, { sync_bytes: number; request_bytes: number; background_bytes: number }>,
  processUsage: ReturnType<typeof buildProcessUsageTable>,
): void {
  const metricW = 18;
  const providerW = 18;
  const heliosSorted = [...syncTimes.helios.entries()].sort((a, b) => a[0] - b[0]);

  const row = (metric: string, rpc: string, helios: string[], colibri: string): MetricsRow => ({
    metric,
    rpc: rpc || '-',
    helios: helios.length > 0 ? helios : ['-'],
    colibri: colibri || '-',
  });

  const trpc = trafficByProvider.get('rpc');
  const thelios = trafficByProvider.get('helios');
  const tcolibri = trafficByProvider.get('colibri');

  const dataRows: MetricsRow[] = [];

  // Sync time (multi-line for helios)
  dataRows.push(
    row(
      'Sync time',
      syncTimes.rpc != null ? formatMsUniform(syncTimes.rpc.ms) : '',
      heliosSorted.map(([d, e]) => `${d}d: ${formatMsUniform(e.ms)}`),
      syncTimes.colibri != null ? formatMsUniform(syncTimes.colibri.ms) : '',
    ),
  );

  // Sync data (multi-line for helios, with interval label like Sync time)
  dataRows.push(
    row(
      'Sync data',
      syncTimes.rpc?.sync_bytes != null ? formatBytes(syncTimes.rpc.sync_bytes) : '',
      heliosSorted.map(([d, e]) => `${d}d: ${e.sync_bytes != null ? formatBytes(e.sync_bytes) : '-'}`),
      syncTimes.colibri?.sync_bytes != null ? formatBytes(syncTimes.colibri.sync_bytes) : '',
    ),
  );

  // Background data (single line; one value per provider from traffic summary)
  dataRows.push(
    row(
      'Background data',
      trpc ? formatBytes(trpc.background_bytes) : '',
      thelios ? [formatBytes(thelios.background_bytes)] : [],
      tcolibri ? formatBytes(tcolibri.background_bytes) : '',
    ),
  );

  // Request data (single line)
  dataRows.push(
    row(
      'Request data',
      trpc ? formatBytes(trpc.request_bytes) : '',
      thelios ? [formatBytes(thelios.request_bytes)] : [],
      tcolibri ? formatBytes(tcolibri.request_bytes) : '',
    ),
  );

  // Total data (single line)
  const total = (t: { sync_bytes: number; request_bytes: number; background_bytes: number }) =>
    formatBytes(t.sync_bytes + t.request_bytes + t.background_bytes);
  dataRows.push(
    row(
      'Total data',
      trpc ? total(trpc) : '',
      thelios ? [total(thelios)] : [],
      tcolibri ? total(tcolibri) : '',
    ),
  );

  // Process section: single line per provider (helios: one value, e.g. first interval)
  const processRows: MetricsRow[] = [];
  const usageRpc = processUsage.rpc;
  const usageHeliosFirst = heliosSorted.length > 0 ? processUsage.helios.get(heliosSorted[0][0]) : undefined;
  const usageColibri = processUsage.colibri;

  if (usageRpc || usageColibri || usageHeliosFirst) {
    processRows.push(
      row(
        'User time',
        usageRpc ? formatMsUniform(usageRpc.user_cpu_us / 1000) : '',
        usageHeliosFirst ? [formatMsUniform(usageHeliosFirst.user_cpu_us / 1000)] : [],
        usageColibri ? formatMsUniform(usageColibri.user_cpu_us / 1000) : '',
      ),
      row(
        'System time',
        usageRpc ? formatMsUniform(usageRpc.system_cpu_us / 1000) : '',
        usageHeliosFirst ? [formatMsUniform(usageHeliosFirst.system_cpu_us / 1000)] : [],
        usageColibri ? formatMsUniform(usageColibri.system_cpu_us / 1000) : '',
      ),
      row(
        'Wall',
        usageRpc ? formatMsUniform(usageRpc.wall_ms) : '',
        usageHeliosFirst ? [formatMsUniform(usageHeliosFirst.wall_ms)] : [],
        usageColibri ? formatMsUniform(usageColibri.wall_ms) : '',
      ),
      row(
        'CPU',
        usageRpc ? `${usageRpc.cpu_percent.toFixed(1)}%` : '',
        usageHeliosFirst ? [`${usageHeliosFirst.cpu_percent.toFixed(1)}%`] : [],
        usageColibri ? `${usageColibri.cpu_percent.toFixed(1)}%` : '',
      ),
    );
  }

  const hasData = dataRows.some((r) => r.rpc !== '-' || r.colibri !== '-' || r.helios.some((h) => h !== '-'));
  if (!hasData && processRows.length === 0) return;

  console.log('\n  Metrics overview (best per provider / per helios checkpoint interval)');
  console.log('  ' + '-'.repeat(metricW + 3 * (providerW + 3)));
  console.log(
    '  ' +
      'Metric'.padEnd(metricW) +
      ' | ' +
      'RPC'.padEnd(providerW) +
      ' | ' +
      'Helios'.padEnd(providerW) +
      ' | ' +
      'Colibri'.padEnd(providerW),
  );
  console.log('  ' + '-'.repeat(metricW + 3 * (providerW + 3)));

  const printRow = (r: MetricsRow) => {
    const lines = Math.max(1, r.helios.length);
    for (let i = 0; i < lines; i++) {
      const rpcCell = i === 0 ? r.rpc : '';
      const heliosCell = r.helios[i] ?? r.helios[0] ?? '-';
      const colibriCell = i === 0 ? r.colibri : '';
      console.log(
        '  ' +
          (i === 0 ? r.metric : '').padEnd(metricW) +
          ' | ' +
          rpcCell.padEnd(providerW) +
          ' | ' +
          heliosCell.padEnd(providerW) +
          ' | ' +
          colibriCell.padEnd(providerW),
      );
    }
  };

  for (const r of dataRows) printRow(r);
  if (processRows.length > 0) {
    console.log('  ' + ' '.repeat(metricW) + ' | ' + ' '.repeat(providerW) + ' | ' + ' '.repeat(providerW) + ' | ' + ' '.repeat(providerW));
    console.log('  ' + '--- Process ---'.padEnd(metricW) + ' | ' + ' '.repeat(providerW) + ' | ' + ' '.repeat(providerW) + ' | ' + ' '.repeat(providerW));
    for (const r of processRows) printRow(r);
  }
  console.log('');
}

/** Per provider, per method: one example error message and total count (across runs). */
function buildFailureSummary(
  runs: BenchmarkResultJson[],
): Map<ProviderKey, Map<string, { message: string; count: number }>> {
  const byProvider = new Map<ProviderKey, Map<string, { message: string; count: number }>>();
  for (const run of runs) {
    const p = run.metadata.provider as ProviderKey;
    if (!PROVIDERS.includes(p)) continue;
    const failures = run.failed_requests ?? [];
    if (failures.length === 0) continue;
    // Group by method within this run (one message, count)
    const runByMethod = new Map<string, { message: string; count: number }>();
    for (const { method, error } of failures) {
      const e = runByMethod.get(method);
      if (e) e.count += 1;
      else runByMethod.set(method, { message: error, count: 1 });
    }
    let methodMap = byProvider.get(p);
    if (!methodMap) {
      methodMap = new Map();
      byProvider.set(p, methodMap);
    }
    for (const [method, { message, count }] of runByMethod) {
      const existing = methodMap.get(method);
      if (existing) existing.count += count;
      else methodMap.set(method, { message, count });
    }
  }
  return byProvider;
}

function printFailureSummary(
  summary: Map<ProviderKey, Map<string, { message: string; count: number }>>,
): void {
  let hasAny = false;
  for (const provider of PROVIDERS) {
    const methodMap = summary.get(provider);
    if (!methodMap || methodMap.size === 0) continue;
    hasAny = true;
  }
  if (!hasAny) return;

  console.log('\n  Failure summary (one message per provider/method, with count)');
  console.log('  ' + '-'.repeat(70));
  for (const provider of PROVIDERS) {
    const methodMap = summary.get(provider);
    if (!methodMap || methodMap.size === 0) continue;
    console.log(`  - ${provider}:`);
    const methods = [...methodMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [method, { message, count }] of methods) {
      const oneLine = message.replace(/\n/g, ' ').slice(0, 80);
      console.log(`      - ${method}: ${oneLine} (${count})`);
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Report output
// ---------------------------------------------------------------------------

function printCombinedReport(
  bestPerProvider: Map<ProviderKey, Map<string, Record<OutcomeKey, BestCell>>>,
  syncTimes: ReturnType<typeof buildSyncTimes>,
  failureSummary: Map<ProviderKey, Map<string, { message: string; count: number }>>,
  trafficByProvider: Map<ProviderKey, { sync_bytes: number; request_bytes: number; background_bytes: number }>,
  processUsage: ReturnType<typeof buildProcessUsageTable>,
): void {
  const allMethods = new Set<string>();
  for (const methodMap of bestPerProvider.values()) {
    for (const method of methodMap.keys()) allMethods.add(method);
  }
  const methods = [...allMethods].sort((a, b) => a.localeCompare(b));

  const cellStr = (cell: BestCell, outcome: OutcomeKey): string => {
    if (cell === null) return '-';
    if (outcome === 'success_result' && cell.traffic_bytes != null && cell.n > 0) {
      const avgB = Math.round(cell.traffic_bytes / cell.n);
      return `${formatMs(cell.avg_ms)} (${cell.n} x ${formatBytes(avgB)})`;
    }
    return `${formatMs(cell.avg_ms)}   ( ${cell.n} )`;
  };

  const providerColWidth = 28;
  const methodColWidth = 25;

  console.log('\n' + '='.repeat(140));
  console.log('  COMBINED BENCHMARK REPORT (best time per provider across runs)');
  console.log('='.repeat(140));

  printMetricsOverview(syncTimes, trafficByProvider, processUsage);

  for (const outcome of OUTCOMES) {
    const label =
      outcome === 'success_result'
        ? 'Success with result'
        : outcome === 'success_no_result'
          ? 'Success no result'
          : 'Failure';
    // Only show methods that have at least one provider with data for this outcome
    const methodsWithData = methods.filter((method) => {
      for (const provider of PROVIDERS) {
        const rec = bestPerProvider.get(provider)?.get(method);
        if (rec?.[outcome] != null) return true;
      }
      return false;
    });
    if (methodsWithData.length === 0) continue;

    console.log(`\n  --- ${label} ---`);
    const header =
      'Method'.padEnd(methodColWidth) + ' | '+
      PROVIDERS.map((p) => p.toUpperCase().padEnd(providerColWidth)).join(' | ');
    console.log('  ' + header);
    console.log('  ' + '-'.repeat(header.length));

    for (const method of methodsWithData) {
      const rowParts = [method.padEnd(methodColWidth)];
      for (const provider of PROVIDERS) {
        const methodMap = bestPerProvider.get(provider);
        const rec = methodMap?.get(method);
        const cell = rec?.[outcome] ?? null;
        rowParts.push(cellStr(cell, outcome).padEnd(providerColWidth));
      }
      console.log('  ' + rowParts.join(' | '));
    }
  }

  printFailureSummary(failureSummary);
  console.log('\n' + '='.repeat(140));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseReportArgs(argv: string[]): { resultsDir: string; suite: string | null } {
  let resultsDir = '';
  let suite: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      console.log(`
Usage: pnpm benchmark:report [OPTIONS] [RESULTS_DIR]

Reads <provider>_<suite>_<timestamp>.json files from RESULTS_DIR (default:
tests/benchmarks/results/) and prints a combined table comparing RPC, Helios,
and Colibri. For each provider, the best (lowest) average time per method and
outcome across runs is used.

Options:
  --suite <name>    Only include runs for this test suite (metadata.suite).
                    If omitted, all result files are merged.
  -h, --help        Show this help.
`.trim());
      process.exit(0);
    }
    if (arg === '--suite') {
      suite = argv[i + 1] ?? null;
      i++;
      continue;
    }
    if (!arg.startsWith('-')) {
      resultsDir = arg;
    }
  }
  return { resultsDir, suite };
}

function main(): void {
  const argv = process.argv.slice(2);
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const { resultsDir: resultsDirArg, suite } = parseReportArgs(argv);
  const resultsDir = resultsDirArg ? path.resolve(resultsDirArg) : path.join(__dirname, 'results');

  if (!fs.existsSync(resultsDir)) {
    console.error(`Results directory not found: ${resultsDir}`);
    process.exit(1);
  }

  let runs = loadResultFiles(resultsDir);
  if (suite !== null) {
    runs = runs.filter((r) => r.metadata.suite === suite);
  }
  if (runs.length === 0) {
    console.error(
      suite !== null
        ? `No benchmark result JSON files found in ${resultsDir} for suite "${suite}".`
        : `No benchmark result JSON files found in ${resultsDir}`,
    );
    process.exit(1);
  }

  const suiteNote = suite !== null ? ` (suite: ${suite})` : '';
  console.log(`Loaded ${runs.length} result file(s) from ${resultsDir}${suiteNote}`);
  const bestPerProvider = buildBestPerProvider(runs);
  const syncTimes = buildSyncTimes(runs);
  const failureSummary = buildFailureSummary(runs);
  const trafficByProvider = buildTrafficSummary(runs);
  const processUsage = buildProcessUsageTable(runs);
  printCombinedReport(bestPerProvider, syncTimes, failureSummary, trafficByProvider, processUsage);
}

main();

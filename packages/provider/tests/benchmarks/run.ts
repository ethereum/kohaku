import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NdjsonEntry {
  t: number; // relative timestamp in ms since session start
  request: {
    id: number;
    method: string;
    params: unknown[];
  };
}

type ResultCategory = 'success_result' | 'success_no_result' | 'failure';

interface RequestResult {
  method: string;
  durationMs: number;
  category: ResultCategory;
  error?: string;
  traffic_bytes?: number;
}

interface MethodStats {
  successResult: { count: number; totalMs: number; trafficBytes: number };
  successNoResult: { count: number; totalMs: number; trafficBytes: number };
  failure: { count: number; totalMs: number; trafficBytes: number };
}

/** Unified low-level RPC sender used by the benchmark loop. */
type SendFn = (method: string, params: unknown[]) => Promise<unknown>;

function classifyResult(value: unknown): 'success_result' | 'success_no_result' {
  if (value === null || value === undefined) return 'success_no_result';
  if (Array.isArray(value) && value.length === 0) return 'success_no_result';
  return 'success_result';
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  execution: string;
  consensus: string;
  prover: string;
  provider: 'rpc' | 'helios' | 'colibri';
  checkpointInterval: number;
  suite: string;
  measureTraffic: boolean;
}

function printHelp(): void {
  // Keep this text simple and copy/paste friendly for terminals.
  console.log(`
Provider benchmark runner (Sepolia)

Usage:
  pnpm benchmark -- [options]

Options:
  --execution <URL>            Execution layer RPC
                               default: https://sepolia.colibri-proof.tech/execution

  --consensus <URL>            Consensus layer Beacon API
                               default: https://sepolia.colibri-proof.tech/consensus

  --prover <URL>               Colibri prover URL
                               default: https://sepolia.colibri-proof.tech/

  --provider rpc|helios|colibri
                               Provider type
                               default: rpc

  --checkpoint_interval <days> Days between checkpoint and latest period (Helios)
                               default: 1

  --suite <name>               NDJSON suite file name (in tests/benchmarks/<name>.ndjson)
                               default: ethers

  --measure-traffic            Run requests through an in-process proxy and record bytes (total, per-request, background)

  -h, --help                   Show this help and exit

Examples:
  pnpm benchmark
  pnpm benchmark -- --provider helios --suite decrypt --checkpoint_interval 2
  pnpm benchmark -- --provider colibri --suite decrypt
`.trim());
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const defaults: CliArgs = {
    execution: 'https://sepolia.colibri-proof.tech/execution',
    consensus: 'http://unstable.sepolia.beacon-api.nimbus.team',
    prover: 'https://sepolia.colibri-proof.tech/',
    provider: 'rpc',
    checkpointInterval: 1,
    suite: 'decrypt',
    measureTraffic: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
      case '--execution':
        defaults.execution = next ?? defaults.execution;
        i++;
        break;
      case '--consensus':
        defaults.consensus = next ?? defaults.consensus;
        i++;
        break;
      case '--prover':
        defaults.prover = next ?? defaults.prover;
        i++;
        break;
      case '--provider':
        if (next === 'rpc' || next === 'helios' || next === 'colibri') {
          defaults.provider = next;
        } else {
          console.error(`Unknown provider: ${next}. Must be rpc|helios|colibri`);
          process.exit(1);
        }
        i++;
        break;
      case '--checkpoint_interval':
        defaults.checkpointInterval = Number(next);
        i++;
        break;
      case '--suite':
        defaults.suite = next ?? defaults.suite;
        i++;
        break;
      case '--measure-traffic':
        defaults.measureTraffic = true;
        break;
      case '--':
        // Skip separator (passed through by pnpm/npm)
        break;
      default:
        console.error(`Unknown argument: ${arg}`);
        console.error(`Run with --help to see supported options.`);
        process.exit(1);
    }
  }

  return defaults;
}

// ---------------------------------------------------------------------------
// NDJSON loader
// ---------------------------------------------------------------------------

function loadNdjson(suiteName: string): NdjsonEntry[] {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const filePath = path.resolve(__dirname, `${suiteName}.ndjson`);

  if (!fs.existsSync(filePath)) {
    console.error(`Suite file not found: ${filePath}`);
    process.exit(1);
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

  // Methods that must not be replayed (state-changing transactions)
  const skipMethods = new Set(['eth_sendRawTransaction', 'eth_sendTransaction']);

  return lines
    .map((line, idx) => {
      try {
        return JSON.parse(line) as NdjsonEntry;
      } catch {
        console.error(`Failed to parse NDJSON line ${idx + 1}`);
        process.exit(1);
      }
    })
    .filter((entry) => !skipMethods.has(entry.request.method))
    .map((entry) => ({ ...entry, request: { ...entry.request, params: sanitizeParams(entry.request.params) } }));
}

/**
 * Sanitize request params before replaying.
 * For example, "pending" block tags are replaced with "latest" since
 * the benchmark runs against a live chain at a different point in time.
 */
function sanitizeParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p === 'pending') return 'latest';
    if (Array.isArray(p)) return sanitizeParams(p);
    if (p !== null && typeof p === 'object') return sanitizeParamsObject(p as Record<string, unknown>);
    return p;
  });
}

function sanitizeParamsObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === 'pending') {
      result[key] = 'latest';
    } else if (Array.isArray(value)) {
      result[key] = sanitizeParams(value);
    } else if (value !== null && typeof value === 'object') {
      result[key] = sanitizeParamsObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Helios checkpoint resolution via Beacon API
// ---------------------------------------------------------------------------

async function resolveHeliosCheckpoint(
  consensusUrl: string,
  checkpointIntervalDays: number,
): Promise<string> {
  // Fetch current head slot
  const headRes = await fetch(`${consensusUrl}/eth/v1/beacon/headers/head`);
  if (!headRes.ok) {
    throw new Error(`Failed to fetch beacon head: ${headRes.status} ${headRes.statusText}`);
  }
  const headJson = (await headRes.json()) as {
    data: { header: { message: { slot: string } } };
  };
  const currentSlot = Number(headJson.data.header.message.slot);

  // Calculate checkpoint slot: go back by checkpoint_interval days worth of slots (12s each)
  const slotsBack = Math.floor((checkpointIntervalDays * 24 * 3600) / 12);
  let checkpointSlot = currentSlot - slotsBack;

  // Align to epoch boundary (32 slots per epoch)
  checkpointSlot -= checkpointSlot % 32;

  console.log(
    `  current slot: ${currentSlot}, checkpoint slot: ${checkpointSlot} (${checkpointIntervalDays}d back)`,
  );

  // Fetch block root at the checkpoint slot
  const cpRes = await fetch(`${consensusUrl}/eth/v1/beacon/headers/${checkpointSlot}`);
  if (!cpRes.ok) {
    throw new Error(
      `Failed to fetch beacon header at slot ${checkpointSlot}: ${cpRes.status} ${cpRes.statusText}`,
    );
  }
  const cpJson = (await cpRes.json()) as { data: { root: string } };
  const root = cpJson.data.root;

  console.log(`  checkpoint root: ${root}`);
  return root;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// ---------------------------------------------------------------------------
// Colibri cache cleanup (so Colibri does not skip syncing)
// ---------------------------------------------------------------------------

const COLIBRI_SEPOLIA_PREFIXES = ['sync_11155111_', 'states_11155111'];

function clearColibriCache(dir: string = process.cwd()): void {
  let deleted = 0;
  try {
    const names = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of names) {
      if (!e.isFile()) continue;
      const name = e.name;
      if (COLIBRI_SEPOLIA_PREFIXES.some((p) => name.startsWith(p))) {
        fs.unlinkSync(path.join(dir, name));
        deleted++;
      }
    }
  } catch (err) {
    // Ignore missing dir or permission errors
  }
  if (deleted > 0) {
    console.log(`  cleared ${deleted} Colibri cache file(s) in ${dir}`);
  }
}

// ---------------------------------------------------------------------------
// Provider factory — returns a unified SendFn
// ---------------------------------------------------------------------------

async function createSendFn(args: CliArgs): Promise<SendFn> {
  switch (args.provider) {
    case 'rpc': {
      const { JsonRpcProvider } = await import('ethers');
      const provider = new JsonRpcProvider(args.execution);
      return (method, params) => provider.send(method, params);
    }

    case 'helios': {
      const { createHeliosProvider } = await import('@a16z/helios');
      const checkpoint = await resolveHeliosCheckpoint(args.consensus, args.checkpointInterval);

      const SYNC_TIMEOUT_MS = 600_000; // 10 minutes

      console.log(`  creating helios provider...`);
      const client = await createHeliosProvider(
        {
          executionRpc: args.execution,
          consensusRpc: args.consensus,
          checkpoint,
          network: 'sepolia',
        },
        'ethereum',
      );

      console.log(`  waiting for helios sync (timeout: ${SYNC_TIMEOUT_MS / 1000}s)...`);
      await withTimeout(
        client.waitSynced(),
        SYNC_TIMEOUT_MS,
        'Helios sync timed out.',
      );
      console.log(`  helios synced.`);

      // HeliosProvider is EIP-1193 compatible
      return (method, params) =>
        (client as unknown as { request(a: { method: string; params: unknown[] }): Promise<unknown> })
          .request({ method, params });
    }

    case 'colibri': {
      const { colibri } = await import('../../src/colibri/index.js');
      const provider = await colibri({
        chainId: 11155111, // Sepolia
        beacon_apis: [args.consensus],
        rpcs: [args.execution],
        prover: [args.prover],
      });
      // Colibri is EIP-1193 compatible
      return (method, params) =>
        (provider._internal as unknown as { request(a: { method: string; params?: unknown[] }): Promise<unknown> })
          .request({ method, params });
    }
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s';
  const totalSec = Math.ceil(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${String(sec).padStart(2, '0')}s`;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function runBenchmark(
  sendFn: SendFn,
  entries: NdjsonEntry[],
  getTotalBytes?: () => number,
): Promise<RequestResult[]> {
  const results: RequestResult[] = [];
  const total = entries.length;
  const sessionStart = performance.now();

  for (let i = 0; i < total; i++) {
    const entry = entries[i]!;

    // Progress indicator (overwrite same line via \r)
    const pct = Math.floor(((i + 1) / total) * 100);
    const elapsed = performance.now() - sessionStart;
    const etaMs = i > 0 ? (elapsed / i) * (total - i) : 0;
    process.stdout.write(
      `\r  ${String(pct).padStart(3)}% - request: ${entry.request.method}  (ETA ${formatDuration(etaMs)})`.padEnd(70),
    );

    // Timing-replay: wait if we are ahead of the recorded timeline
    const sessionElapsed = performance.now() - sessionStart;
    if (sessionElapsed < entry.t) {
      await sleep(entry.t - sessionElapsed);
    }

    const bytesBefore = getTotalBytes?.() ?? 0;

    // Execute and measure
    const reqStart = performance.now();
    try {
      const value = await sendFn(entry.request.method, entry.request.params ?? []);
      const category = classifyResult(value);
      const bytesAfter = getTotalBytes?.() ?? 0;
      results.push({
        method: entry.request.method,
        durationMs: performance.now() - reqStart,
        category,
        traffic_bytes: getTotalBytes ? bytesAfter - bytesBefore : undefined,
      });
    } catch (err: unknown) {
      const bytesAfter = getTotalBytes?.() ?? 0;
      results.push({
        method: entry.request.method,
        durationMs: performance.now() - reqStart,
        category: 'failure',
        error: err instanceof Error ? err.message : String(err),
        traffic_bytes: getTotalBytes ? bytesAfter - bytesBefore : undefined,
      });
    }
  }

  // Clear progress line
  process.stdout.write('\r' + ' '.repeat(70) + '\r');

  return results;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms.toFixed(1)}ms`;
}

// ---------------------------------------------------------------------------
// JSON result file (for report.ts)
// ---------------------------------------------------------------------------

export interface BenchmarkResultJson {
  metadata: {
    timestamp: string;
    suite: string;
    provider: string;
    execution: string;
    consensus: string;
    prover: string;
    checkpoint_interval: number;
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
  traffic?: {
    sync_bytes: number;
    request_bytes: number;
    background_bytes: number;
  };
  /** Process resource usage for the measured interval (sync + replay). */
  process_usage?: {
    user_cpu_us: number;
    system_cpu_us: number;
    wall_ms: number;
    cpu_percent: number;
  };
}

function buildReportData(
  syncTimeMs: number,
  results: RequestResult[],
  metadata: CliArgs,
  traffic?: { sync_bytes: number; request_bytes: number; background_bytes: number },
  process_usage?: { user_cpu_us: number; system_cpu_us: number; wall_ms: number; cpu_percent: number },
): { byMethod: Map<string, MethodStats>; json: BenchmarkResultJson } {
  const emptyStats = (): MethodStats => ({
    successResult: { count: 0, totalMs: 0, trafficBytes: 0 },
    successNoResult: { count: 0, totalMs: 0, trafficBytes: 0 },
    failure: { count: 0, totalMs: 0, trafficBytes: 0 },
  });
  const byMethod = new Map<string, MethodStats>();
  for (const r of results) {
    const stats = byMethod.get(r.method) ?? emptyStats();
    const tb = r.traffic_bytes ?? 0;
    if (r.category === 'success_result') {
      stats.successResult.count++;
      stats.successResult.totalMs += r.durationMs;
      stats.successResult.trafficBytes += tb;
    } else if (r.category === 'success_no_result') {
      stats.successNoResult.count++;
      stats.successNoResult.totalMs += r.durationMs;
      stats.successNoResult.trafficBytes += tb;
    } else {
      stats.failure.count++;
      stats.failure.totalMs += r.durationMs;
      stats.failure.trafficBytes += tb;
    }
    byMethod.set(r.method, stats);
  }

  const methods: BenchmarkResultJson['methods'] = {};
  for (const [method, stats] of byMethod) {
    const avg = (count: number, totalMs: number): number | null =>
      count === 0 ? null : totalMs / count;
    methods[method] = {
      success_result: {
        avg_ms: avg(stats.successResult.count, stats.successResult.totalMs),
        n: stats.successResult.count,
        ...(stats.successResult.trafficBytes > 0 && { traffic_bytes: stats.successResult.trafficBytes }),
      },
      success_no_result: {
        avg_ms: avg(stats.successNoResult.count, stats.successNoResult.totalMs),
        n: stats.successNoResult.count,
        ...(stats.successNoResult.trafficBytes > 0 && { traffic_bytes: stats.successNoResult.trafficBytes }),
      },
      failure: {
        avg_ms: avg(stats.failure.count, stats.failure.totalMs),
        n: stats.failure.count,
        ...(stats.failure.trafficBytes > 0 && { traffic_bytes: stats.failure.trafficBytes }),
      },
    };
  }
  const failed_requests = results
    .filter((r) => r.category === 'failure')
    .map((r) => ({ method: r.method, error: r.error ?? 'Unknown error' }));

  const json: BenchmarkResultJson = {
    metadata: {
      timestamp: new Date().toISOString(),
      suite: metadata.suite,
      provider: metadata.provider,
      execution: metadata.execution,
      consensus: metadata.consensus,
      prover: metadata.prover,
      checkpoint_interval: metadata.checkpointInterval,
    },
    sync_time_ms: syncTimeMs,
    methods,
    failed_requests,
    ...(traffic && { traffic }),
    ...(process_usage && { process_usage }),
  };
  return { byMethod, json };
}

function printReport(
  syncTimeMs: number,
  results: RequestResult[],
  byMethod: Map<string, MethodStats>,
  traffic?: { sync_bytes: number; request_bytes: number; background_bytes: number },
  process_usage?: { user_cpu_us: number; system_cpu_us: number; wall_ms: number; cpu_percent: number },
): void {
  const totalRequestMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const totalFailures = results.filter((r) => r.category === 'failure').length;

  console.log('\n' + '='.repeat(100));
  console.log('  BENCHMARK RESULTS');
  console.log('='.repeat(100));
  console.log(`  Sync time:          ${formatMs(syncTimeMs)}`);
  console.log(`  Total request time: ${formatMs(totalRequestMs)}`);
  console.log(`  Requests:           ${results.length}`);
  console.log(`  Failures:           ${totalFailures}`);
  if (traffic) {
    const fmt = (b: number) => (b >= 1024 ? `${(b / 1024).toFixed(1)} KB` : `${b} B`);
    console.log(`  Traffic:            sync ${fmt(traffic.sync_bytes)}, request ${fmt(traffic.request_bytes)}, background ${fmt(traffic.background_bytes)}`);
  }
  if (process_usage) {
    const u = process_usage.user_cpu_us / 1e6;
    const s = process_usage.system_cpu_us / 1e6;
    const wallSec = process_usage.wall_ms / 1000;
    const wallStr = wallSec >= 60 ? `${Math.floor(wallSec / 60)}:${String(Math.round(wallSec % 60)).padStart(2, '0')}` : `${wallSec.toFixed(1)}s`;
    console.log(`  Process usage:      user ${u.toFixed(2)}s, system ${s.toFixed(2)}s, wall ${wallStr}, ${process_usage.cpu_percent.toFixed(1)}% cpu`);
  }
  console.log('-'.repeat(100));

  // Table header: Method | success_result (avg, n) | success_no_result (avg, n) | failure (avg, n)
  const col = (label: string, w: number) => label.padEnd(w);
  const header = [
    col('Method', 28),
    col('success_result (avg, n)', 26),
    col('success_no_result (avg, n)', 28),
    col('failure (avg, n)', 22),
  ].join(' | ');
  console.log(`  ${header}`);
  console.log('  ' + '-'.repeat(header.length));

  const cell = (count: number, totalMs: number): string =>
    count === 0 ? '-' : `${formatMs(totalMs / count)}, ${count}`;

  // Sort alphabetically by method name
  const sorted = [...byMethod.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [method, stats] of sorted) {
    const row = [
      method.padEnd(28),
      cell(stats.successResult.count, stats.successResult.totalMs).padEnd(26),
      cell(stats.successNoResult.count, stats.successNoResult.totalMs).padEnd(28),
      cell(stats.failure.count, stats.failure.totalMs).padEnd(22),
    ].join(' | ');
    console.log(`  ${row}`);
  }

  console.log('='.repeat(100));

  // Print failed requests
  if (totalFailures > 0) {
    console.log('\n  FAILED REQUESTS:');
    console.log('  ' + '-'.repeat(66));
    for (const r of results) {
      if (r.category === 'failure') {
        console.log(`  [${r.method}] ${r.error}`);
      }
    }
    console.log();
  }
}

function writeResultJson(json: BenchmarkResultJson, outDir: string): string {
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const name = `${json.metadata.provider}_${json.metadata.suite}_${ts}.json`;
  const filePath = path.join(outDir, name);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
  return filePath;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  console.log(`Provider Benchmark`);
  console.log(`  provider:            ${args.provider}`);
  console.log(`  execution:           ${args.execution}`);
  console.log(`  consensus:           ${args.consensus}`);
  console.log(`  prover:              ${args.prover}`);
  console.log(`  checkpoint_interval: ${args.checkpointInterval}d`);
  console.log(`  suite:               ${args.suite}`);
  console.log();

  // Load test data
  const entries = loadNdjson(args.suite);
  console.log(`Loaded ${entries.length} requests from ${args.suite}.ndjson`);

  // Clear Colibri cache before measuring (so sync_time is not inflated when provider is colibri)
  clearColibriCache();

  let argsForProvider = args;
  let proxy: Awaited<ReturnType<typeof import('./traffic-proxy.js').createTrafficProxy>> | undefined;
  if (args.measureTraffic) {
    const { createTrafficProxy } = await import('./traffic-proxy.js');
    proxy = await createTrafficProxy({
      executionUrl: args.execution,
      consensusUrl: args.consensus,
      proverUrl: args.prover,
    });
    argsForProvider = {
      ...args,
      execution: proxy.proxyUrls.execution,
      consensus: proxy.proxyUrls.consensus,
      prover: proxy.proxyUrls.prover,
    };
    console.log(`  Traffic proxy listening (execution/consensus/prover).`);
  }

  // Measured interval: sync + replay (for process_usage)
  const wallStart = Date.now();
  const usageStart = process.resourceUsage();

  // Sync phase: create provider + call eth_blockNumber
  console.log(`\nSync phase (${args.provider})...`);
  const syncStart = performance.now();
  const sendFn = await createSendFn(argsForProvider);
  const blockNumber = await sendFn('eth_blockNumber', []);
  const syncTimeMs = performance.now() - syncStart;
  console.log(`  synced in ${formatMs(syncTimeMs)}, block: ${blockNumber}`);

  const syncTrafficBytes = proxy ? proxy.getTotalBytes() : 0;

  // Request replay phase
  console.log(`\nReplaying ${entries.length} requests...`);
  const results = await runBenchmark(sendFn, entries, proxy?.getTotalBytes);

  let traffic: { sync_bytes: number; request_bytes: number; background_bytes: number } | undefined;
  if (proxy) {
    const total_bytes = proxy.getTotalBytes();
    const request_bytes = results.reduce((s, r) => s + (r.traffic_bytes ?? 0), 0);
    traffic = {
      sync_bytes: syncTrafficBytes,
      request_bytes,
      background_bytes: total_bytes - syncTrafficBytes - request_bytes,
    };
    await proxy.close();
  }

  const usageEnd = process.resourceUsage();
  const wallMs = Date.now() - wallStart;
  const user_cpu_us = usageEnd.userCPUTime - usageStart.userCPUTime;
  const system_cpu_us = usageEnd.systemCPUTime - usageStart.systemCPUTime;
  const process_usage =
    wallMs > 0
      ? {
          user_cpu_us,
          system_cpu_us,
          wall_ms: wallMs,
          cpu_percent: (100 * (user_cpu_us + system_cpu_us)) / 1e6 / (wallMs / 1000),
        }
      : undefined;

  // Build data, print report, write JSON
  const { byMethod, json } = buildReportData(syncTimeMs, results, args, traffic, process_usage);
  printReport(syncTimeMs, results, byMethod, traffic, process_usage);

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const resultsDir = path.join(__dirname, 'results');
  const written = writeResultJson(json, resultsDir);
  console.log(`\n  Results written to ${written}`);

  // Exit explicitly so background work (e.g. Helios) does not keep the process alive
  process.exit(0);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

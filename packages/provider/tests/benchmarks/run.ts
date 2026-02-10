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

interface RequestResult {
  method: string;
  durationMs: number;
  ok: boolean;
  error?: string;
}

interface MethodStats {
  count: number;
  totalMs: number;
  failures: number;
}

/** Unified low-level RPC sender used by the benchmark loop. */
type SendFn = (method: string, params: unknown[]) => Promise<unknown>;

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
    consensus: 'https://sepolia.colibri-proof.tech/consensus',
    prover: 'https://sepolia.colibri-proof.tech/',
    provider: 'rpc',
    checkpointInterval: 1,
    suite: 'decrypt',
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

      const SYNC_TIMEOUT_MS = 120_000; // 2 minutes

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

async function runBenchmark(sendFn: SendFn, entries: NdjsonEntry[]): Promise<RequestResult[]> {
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

    // Execute and measure
    const reqStart = performance.now();
    try {
      await sendFn(entry.request.method, entry.request.params ?? []);
      results.push({
        method: entry.request.method,
        durationMs: performance.now() - reqStart,
        ok: true,
      });
    } catch (err: unknown) {
      results.push({
        method: entry.request.method,
        durationMs: performance.now() - reqStart,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
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

function printReport(syncTimeMs: number, results: RequestResult[]): void {
  const totalRequestMs = results.reduce((sum, r) => sum + r.durationMs, 0);
  const totalFailures = results.filter((r) => !r.ok).length;

  // Aggregate per method
  const byMethod = new Map<string, MethodStats>();
  for (const r of results) {
    const stats = byMethod.get(r.method) ?? { count: 0, totalMs: 0, failures: 0 };
    stats.count++;
    stats.totalMs += r.durationMs;
    if (!r.ok) stats.failures++;
    byMethod.set(r.method, stats);
  }

  console.log('\n' + '='.repeat(70));
  console.log('  BENCHMARK RESULTS');
  console.log('='.repeat(70));
  console.log(`  Sync time:          ${formatMs(syncTimeMs)}`);
  console.log(`  Total request time: ${formatMs(totalRequestMs)}`);
  console.log(`  Requests:           ${results.length}`);
  console.log(`  Failures:           ${totalFailures}`);
  console.log('-'.repeat(70));

  // Table header
  const header = [
    'Method'.padEnd(30),
    'Count'.padStart(6),
    'Total'.padStart(10),
    'Avg'.padStart(10),
    'Fail'.padStart(6),
  ].join(' | ');
  console.log(`  ${header}`);
  console.log('  ' + '-'.repeat(header.length));

  // Sort by total time descending
  const sorted = [...byMethod.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
  for (const [method, stats] of sorted) {
    const avg = stats.totalMs / stats.count;
    const row = [
      method.padEnd(30),
      String(stats.count).padStart(6),
      formatMs(stats.totalMs).padStart(10),
      formatMs(avg).padStart(10),
      String(stats.failures).padStart(6),
    ].join(' | ');
    console.log(`  ${row}`);
  }

  console.log('='.repeat(70));

  // Print failed requests
  if (totalFailures > 0) {
    console.log('\n  FAILED REQUESTS:');
    console.log('  ' + '-'.repeat(66));
    for (const r of results) {
      if (!r.ok) {
        console.log(`  [${r.method}] ${r.error}`);
      }
    }
    console.log();
  }
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

  // Sync phase: create provider + call eth_blockNumber
  console.log(`\nSync phase (${args.provider})...`);
  const syncStart = performance.now();
  const sendFn = await createSendFn(args);
  const blockNumber = await sendFn('eth_blockNumber', []);
  const syncTimeMs = performance.now() - syncStart;
  console.log(`  synced in ${formatMs(syncTimeMs)}, block: ${blockNumber}`);

  // Request replay phase
  console.log(`\nReplaying ${entries.length} requests...`);
  const results = await runBenchmark(sendFn, entries);

  // Report
  printReport(syncTimeMs, results);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

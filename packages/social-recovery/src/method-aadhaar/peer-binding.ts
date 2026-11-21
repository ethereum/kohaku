import type { AadhaarInitArgument } from '../types/method-aadhaar';

/** The argument the peer's `init` last took on this page, `undefined` before the first and while or after one fails. */
let bound: AadhaarInitArgument | undefined;

/** The peer calls in flight under `bound`, each held until the peer's own promise settles. */
const running = new Set<Promise<unknown>>();

/** Settles once every call queued so far has taken its turn. */
let queue: Promise<void> = Promise.resolve();

/** The queued calls that have not taken their turn yet; while any wait, every new call queues behind them. */
let waiting = 0;

const sameArgument = (held: AadhaarInitArgument | undefined, wanted: AadhaarInitArgument): boolean =>
  held !== undefined &&
  held.wasmURL === wanted.wasmURL &&
  held.zkeyURL === wanted.zkeyURL &&
  held.vkeyURL === wanted.vkeyURL &&
  held.artifactsOrigin === wanted.artifactsOrigin;

const invoke = async <T>(call: () => Promise<T>): Promise<T> => call();

/** Starts the call, held in `running` until it settles. */
function track<T>(call: () => Promise<T>): Promise<T> {
  const work = invoke(call);
  const release = (): void => {
    running.delete(work);
  };

  running.add(work);
  work.then(release, release);

  return work;
}

/** Settles once no call is in flight under the binding. */
async function drained(): Promise<void> {
  while (running.size > 0) await Promise.allSettled([...running]);
}

/** Throws the signal's reason where it has aborted, or what its getter throws. */
function stopIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw signal.reason;
}

/** Gives the peer `argument` through `init`; the binding stays unknown while `init` runs and after it fails. */
async function rebind(argument: AadhaarInitArgument, init: () => Promise<void>): Promise<void> {
  bound = undefined;
  await init();
  bound = argument;
}

/**
 * Runs a peer call that reads the circuit's files once the page-global peer holds `argument`, compared by value. A call under the
 * bound argument runs at once, beside the others, while no call waits; any other call waits its turn, until every call in flight
 * under the binding has settled, and then `init` gives the peer `argument`. A call whose signal has aborted by its turn never reaches
 * the peer, and a failed `init` rejects that call and leaves the binding unknown, so the next call initialises again.
 */
export async function underBinding<T>(
  argument: AadhaarInitArgument,
  init: () => Promise<void>,
  call: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (waiting === 0 && sameArgument(bound, argument)) {
    stopIfAborted(signal);

    return track(call);
  }

  waiting += 1;

  const turn = queue.then(async () => {
    try {
      if (!sameArgument(bound, argument)) {
        await drained();
        stopIfAborted(signal);
        await rebind(argument, init);
      }

      stopIfAborted(signal);

      return { work: track(call) };
    } finally {
      waiting -= 1;
    }
  });

  queue = turn.then(
    () => undefined,
    () => undefined,
  );

  return (await turn).work;
}

/** Forgets the binding and every call it tracks, as on a new page. */
export function forgetPeerBinding(): void {
  bound = undefined;
  running.clear();
  queue = Promise.resolve();
  waiting = 0;
}

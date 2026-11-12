import { StoreKey } from "../../plugin/interfaces/protocol-params.interface";

/**
 * Callers that ask for a value while it is being loaded share it, instead of
 * each building their own. A failed load is forgotten, so the next call retries
 * rather than replays the failure forever.
 */
export const createLoadCache = <T>() => {
  const loads = new Map<StoreKey, Promise<T>>();

  return (key: StoreKey, load: () => Promise<T>): Promise<T> => {
    let loading = loads.get(key);

    if (!loading) {
      loading = load().catch((error: unknown) => {
        loads.delete(key);
        throw error;
      });
      loads.set(key, loading);
    }

    return loading;
  };
};

/**
 * At most one run at a time. A call never joins a run that already started: that
 * run's head may predate a transaction the caller just saw confirmed. It waits
 * for one follow-up run instead, shared with every call made while the follow-up
 * has not started.
 */
export const createSyncQueue = () => {
  let running: Promise<void> | undefined;
  let queued: Promise<void> | undefined;

  return (run: () => Promise<void>): Promise<void> => {
    if (queued) return queued;

    const start = (): Promise<void> => {
      const started = run().finally(() => {
        if (running === started) running = undefined;
      });

      running = started;

      return started;
    };

    if (!running) return start();

    // Runs whether the current run succeeds or fails; its callers get its outcome.
    queued = running.catch(() => undefined).then(() => {
      queued = undefined;

      return start();
    });

    return queued;
  };
};

/**
 * A sync queue whose runs may leave the ASP out. A follow-up run serves every
 * call that joined it, so it skips the ASP only if each of those calls asked to.
 */
export const createSkipAspSyncQueue = () => {
  const enqueue = createSyncQueue();
  let pendingSkipAsp: boolean | undefined;

  return (skipAsp: boolean, run: (skipAsp: boolean) => Promise<void>): Promise<void> => {
    pendingSkipAsp = (pendingSkipAsp ?? true) && skipAsp;

    // Read when the run starts, so it sees every call that joined it.
    return enqueue(() => {
      const runSkipAsp = pendingSkipAsp ?? false;

      pendingSkipAsp = undefined;

      return run(runSkipAsp);
    });
  };
};

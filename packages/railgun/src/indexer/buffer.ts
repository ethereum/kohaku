type Defer = { promise: Promise<void>; resolve: () => void };
const defer = (): Defer => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));

  return { promise, resolve };
};

/**
 * Batch-buffer an async iterable with high/low watermarks.
 * Yields "whatever is ready so far" each time the consumer requests the next batch.
 */
export function batchBuffer<T>(
  source: AsyncIterable<T>,
  opts: { highWater?: number; lowWater?: number } = {}
): AsyncIterable<T[]> {
  const high = opts.highWater ?? 2000;
  const low = opts.lowWater ?? Math.floor(high * 0.4);

  const buf: T[] = [];
  let done = false;
  let error: unknown;

  let consumerWait: Defer | null = null; // consumer waits for data
  let producerWait: Defer | null = null; // producer waits for space

  const wakeConsumer = () => {
    if (consumerWait) {
      const w = consumerWait;

      consumerWait = null;
      w.resolve();
    }
  };
  const wakeProducer = () => {
    if (producerWait) {
      const w = producerWait;

      producerWait = null;
      w.resolve();
    }
  };

  // Producer pump with backpressure
  (async () => {
    try {
      for await (const item of source) {
        console.log("received item");

        if (buf.length >= high) {
          console.log("waiting for producer");
          producerWait = defer();
          await producerWait.promise; // resume when buffer dips below low
        }

        buf.push(item);
        console.log("pushed item");
        wakeConsumer();
        console.log("pump post wake");
      }
      done = true;
      wakeConsumer();
    } catch (e) {
      error = e;
      done = true;
      wakeConsumer();
    }
  })();

  return {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (error) throw error;

        if (buf.length > 0) {
          // hand over *everything currently ready* as a single batch
          const batch = buf.splice(0, buf.length);

          if (buf.length <= low) {
            console.log("waking producer");
            wakeProducer();
            console.log("waked producer");
          }

          console.log("yield");
          yield batch;
          console.log("yielded batch");
          continue;
        }

        if (done) return;

        consumerWait = defer();
        await consumerWait.promise;
      }
    },
  };
}

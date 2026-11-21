/** How many pools are fetched or scanned at once. */
export const POOL_CONCURRENCY = 8;

/**
 * `Promise.allSettled(items.map(fn))`, with at most `limit` calls of `fn` pending
 * at once. Results keep the order of `items`.
 */
export async function allSettledLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;

      try {
        results[index] = { status: 'fulfilled', value: await fn(items[index]!) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

  return results;
}

import fc from 'fast-check';

const numRuns = Number(process.env['FC_NUM_RUNS'] ?? 256);
const seedText = process.env['FC_SEED'];

/** Asserts an async property under the run count and seed taken from `FC_NUM_RUNS` and `FC_SEED`. */
export const runAsync = <T>(property: fc.IAsyncProperty<T>): Promise<void> =>
  fc.assert(property, (seedText === undefined ? { numRuns } : { numRuns, seed: Number(seedText) }) as fc.Parameters<T>);

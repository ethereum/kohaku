import type { Address } from '../interfaces';

/** The entry a registry keys on the address, compared without regard to case. */
export function entryFor<Entry>(registry: ReadonlyMap<Address, Entry>, address: Address): Entry | undefined {
  const exact = registry.get(address);

  if (exact !== undefined) return exact;

  for (const [key, entry] of registry) {
    if (key.toLowerCase() === address.toLowerCase()) return entry;
  }

  return undefined;
}

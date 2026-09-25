import type { Address, DeploymentDescriptor } from '../interfaces';
import type { MethodRegistry } from '../types';

/** The same address, compared without regard to case. */
export const sameAddress = (left: Address, right: Address): boolean => left.toLowerCase() === right.toLowerCase();

/** The addresses without case-insensitive duplicates, each kept in its first spelling. */
const distinct = (addresses: readonly Address[]): readonly Address[] => {
  const seen = new Set<string>();

  return addresses.filter((address) => {
    const key = address.toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
};

/** Every method address the descriptor names or the registry is keyed on, each once. */
export const methodAddresses = (descriptor: DeploymentDescriptor, registry: MethodRegistry): readonly Address[] =>
  distinct([
    descriptor.methodEcdsa,
    descriptor.methodPasskey,
    descriptor.methodAadhaar,
    descriptor.methodZkpassport,
    ...descriptor.shippedMethods,
    ...registry.keys(),
  ]);

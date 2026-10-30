import { BUILDER_DEFAULT_DESCRIPTORS } from '../constants';
import { checkedDescriptor } from '../formats/records';
import type { Address, DeploymentDescriptor } from '../interfaces';
import type { DescriptorOrigin } from '../types/validation';

/** The chain's shipped descriptor, or nothing where no descriptor ships for that chain. */
export const shippedDescriptor = (chainId: number): DeploymentDescriptor | undefined =>
  Object.hasOwn(BUILDER_DEFAULT_DESCRIPTORS, chainId) ? BUILDER_DEFAULT_DESCRIPTORS[chainId] : undefined;

/** Whether two values are the same; addresses compare checksummed. */
const same = <T>(left: T, right: T): boolean => left === right;

/** Whether two checksummed address lists name the same addresses in the same order. */
const sameList = (left: readonly Address[], right: readonly Address[]): boolean =>
  left.length === right.length && left.every((entry, index) => entry === right[index]);

/** One comparison per descriptor member: a member added to the record does not compile until it is named here. */
const DESCRIPTOR_MEMBER_EQUALITY: { [K in keyof DeploymentDescriptor]: (left: DeploymentDescriptor[K], right: DeploymentDescriptor[K]) => boolean } = {
  chainId: same,
  manager: same,
  methodEcdsa: same,
  methodPasskey: same,
  methodAadhaar: same,
  methodZkpassport: same,
  action: same,
  servedImplementation: same,
  deployedAt: same,
  digestVersion: same,
  managerVersion: same,
  shippedMethods: sameList,
  auditedActions: sameList,
};

/** Whether the two descriptors agree on one member. */
const sameMember = <K extends keyof DeploymentDescriptor>(member: K, left: DeploymentDescriptor, right: DeploymentDescriptor): boolean => {
  const equal: (left: DeploymentDescriptor[K], right: DeploymentDescriptor[K]) => boolean = DESCRIPTOR_MEMBER_EQUALITY[member];

  return equal(left[member], right[member]);
};

/**
 * The origin of a descriptor already checked by `checkedDescriptor`: `kit` where it equals its chain's shipped descriptor
 * in every member, `integrator` otherwise. The shipped descriptors are frozen and checksummed where they are defined.
 */
export function checkedDescriptorOrigin(descriptor: DeploymentDescriptor): DescriptorOrigin {
  const shipped = shippedDescriptor(descriptor.chainId);

  if (shipped === undefined) return 'integrator';

  const members = Object.keys(DESCRIPTOR_MEMBER_EQUALITY) as (keyof DeploymentDescriptor)[];

  return members.every((member) => sameMember(member, descriptor, shipped)) ? 'kit' : 'integrator';
}

/**
 * `kit` where the descriptor equals its chain's shipped descriptor in every member, addresses compared checksummed and the
 * audited sets in order; `integrator` otherwise. Throws a `TypeError` or `RangeError` on a malformed descriptor.
 */
export function descriptorOriginOf(descriptor: DeploymentDescriptor): DescriptorOrigin {
  return checkedDescriptorOrigin(checkedDescriptor(descriptor, 'descriptor'));
}

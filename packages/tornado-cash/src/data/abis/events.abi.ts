import { parseAbiItem } from "viem";

export const POOL_EVENTS_SIGNATURES = {
  Deposited: parseAbiItem(
    "event Deposit(bytes32 indexed commitment, uint32 leafIndex, uint256 timestamp)",
  ),
  Withdrawn: parseAbiItem(
    "event Withdrawal(address to, bytes32 nullifierHash, address indexed relayer, uint256 fee)",
  ),
} as const;

export const RELAYER_REGISTRY_EVENTS_SIGNATURES = {
  RelayerRegistered: parseAbiItem("event RelayerRegistered(bytes32 relayer, string ensName, address relayerAddress, uint256 stakedAmount)")
} as const;

export const INSTANCE_REGISTRY_EVENT_SIGNATURES = {
  InstanceStateUpdated: parseAbiItem("event InstanceStateUpdated(address indexed instance, uint8 state)")
}

export const EVENTS_SIGNATURES = {
  ...POOL_EVENTS_SIGNATURES,
  ...RELAYER_REGISTRY_EVENTS_SIGNATURES,
  ...INSTANCE_REGISTRY_EVENT_SIGNATURES,
};

export type PoolEventTypes = typeof POOL_EVENTS_SIGNATURES;
export type RelayerRegistryEventTypes = typeof RELAYER_REGISTRY_EVENTS_SIGNATURES;
export type InstanceRegistryEventTypes = typeof INSTANCE_REGISTRY_EVENT_SIGNATURES;

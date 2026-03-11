import { parseAbiItem } from "viem";

export const POOL_EVENTS_SIGNATURES = {
  PoolDeposited: parseAbiItem(
    "event Deposited(address indexed _depositor, uint256 _commitment, uint256 _label, uint256 _value, uint256 _precommitment)",
  ),
  Withdrawn: parseAbiItem(
    "event Withdrawn(address indexed _processooor, uint256 _value, uint256 _spentNullifier, uint256 _newCommitment)",
  ),
  Ragequit: parseAbiItem(
    "event Ragequit(address indexed _ragequitter, uint256 _commitment, uint256 _label, uint256 _value)",
  ),
  LeafInserted: parseAbiItem(
    "event LeafInserted(uint256 _index, uint256 _leaf, uint256 _root)",
  ),
} as const;

export const ENTRYPOINT_EVENTS_SIGNATURES = {
  EntrypointDeposited: parseAbiItem(
    "event Deposited(address indexed _depositor, address indexed _pool, uint256 _commitment, uint256 _amount)",
  ),
  RootUpdated: parseAbiItem(
    "event RootUpdated(uint256 _root, string _ipfsCID, uint256 _timestamp)",
  ),
  PoolRegistered: parseAbiItem(
    "event PoolRegistered(address _pool, address _asset, uint256 _scope)",
  ),
  PoolWindDown: parseAbiItem("event PoolWindDown(address _pool)"),
} as const;

export const EVENTS_SIGNATURES = {
  ...POOL_EVENTS_SIGNATURES,
  ...ENTRYPOINT_EVENTS_SIGNATURES,
};

export type PoolEventTypes = typeof POOL_EVENTS_SIGNATURES;
export type EntrypointEventTypes = typeof ENTRYPOINT_EVENTS_SIGNATURES;

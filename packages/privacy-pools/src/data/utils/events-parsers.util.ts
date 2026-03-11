import { ContractEventName, ParseEventLogsReturnType } from "viem";
import { EVENTS_SIGNATURES } from "../abis/events.abi";
import {
  IEntrypointEvents,
  IPoolEvents,
} from "../interfaces/data.service.interface";
import { ILeafInsertedEvent } from "../interfaces/events.interface";

type EventsParsersResultsByKey = IEntrypointEvents & IPoolEvents;

export const EVENTS_PARSERS: {
  [key in keyof typeof EVENTS_SIGNATURES]: (
    args: ParseEventLogsReturnType<
      [(typeof EVENTS_SIGNATURES)[key]],
      ContractEventName<[(typeof EVENTS_SIGNATURES)[key]]>,
      true
    >[number],
  ) => EventsParsersResultsByKey[key];
} = {
  PoolDeposited: (log) => {
    const {
      _depositor: depositor,
      _commitment: commitment,
      _label: label,
      _value: value,
      _precommitment: precommitment,
    } = log.args;

    return {
      depositor: BigInt(depositor),
      commitment,
      label,
      value: value || BigInt(0),
      precommitment,
      blockNumber: log.blockNumber,
      transactionHash: BigInt(log.transactionHash),
    };
  },
  Withdrawn: (log) => {
    const {
      _value: value,
      _spentNullifier: spentNullifier,
      _newCommitment: commitment,
    } = log.args;

    return {
      value,
      spentNullifier: spentNullifier,
      commitment,
      blockNumber: log.blockNumber,
      transactionHash: BigInt(log.transactionHash),
    };
  },
  Ragequit: ({ blockNumber, transactionHash, args }) => {
    const {
      _ragequitter: ragequitter,
      _commitment: commitment,
      _label: label,
      _value: value,
    } = args;

    return {
      ragequitter: BigInt(ragequitter),
      commitment: commitment,
      label,
      value: value || BigInt(0),
      blockNumber: blockNumber,
      transactionHash: BigInt(transactionHash),
    };
  },
  EntrypointDeposited: ({
    blockNumber,
    transactionHash,
    args: {
      _pool: poolAddress,
      _amount: value,
      _depositor: depositor,
      _commitment: commitment,
    },
  }) => {
    return {
      blockNumber,
      transactionHash: BigInt(transactionHash),
      depositor: BigInt(depositor),
      poolAddress: BigInt(poolAddress),
      commitment,
      value,
    };
  },
  RootUpdated: ({
    blockNumber,
    transactionHash,
    args: { _root: root, _ipfsCID: ipfsCID, _timestamp: timestamp },
  }) => {
    return {
      blockNumber,
      transactionHash: BigInt(transactionHash),
      root,
      ipfsCID,
      timestamp,
    };
  },
  PoolRegistered: ({
    blockNumber,
    transactionHash,
    args: { _asset: asset, _pool: pool, _scope: scope },
  }) => {
    return {
      blockNumber,
      transactionHash: BigInt(transactionHash),
      asset: BigInt(asset),
      pool: BigInt(pool),
      scope,
    };
  },
  PoolWindDown: ({ blockNumber, transactionHash, args: { _pool: pool } }) => {
    return {
      blockNumber,
      transactionHash: BigInt(transactionHash),
      pool: BigInt(pool),
    };
  },
  LeafInserted: function ({
    args: { _index, _leaf, _root },
    transactionHash,
    blockNumber,
  }): ILeafInsertedEvent {
    return {
      blockNumber,
      transactionHash: BigInt(transactionHash),
      index: _index,
      commitment: _leaf,
      root: _root,
    };
  },
};

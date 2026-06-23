import { ContractEventName, ParseEventLogsReturnType } from "viem";
import { EVENTS_SIGNATURES } from "../abis/events.abi";
import {
  IRelayerRegistryEvents,
  IPoolEvents,
  IInstanceRegistryEvents,
} from "../interfaces/data.service.interface";

type EventsParsersResultsByKey = IRelayerRegistryEvents & IPoolEvents & IInstanceRegistryEvents;

export const EVENTS_PARSERS: {
  [key in keyof typeof EVENTS_SIGNATURES]: (
    args: ParseEventLogsReturnType<
      [(typeof EVENTS_SIGNATURES)[key]],
      ContractEventName<[(typeof EVENTS_SIGNATURES)[key]]>,
      true
    >[number],
  ) => EventsParsersResultsByKey[key];
} = {
  Deposited: (log) => {
    const {
      leafIndex, commitment, timestamp,
    } = log.args;

    return {
      commitment: BigInt(commitment),
      leafIndex,
      timestamp,
      blockNumber: log.blockNumber,
      transactionHash: BigInt(log.transactionHash),
    };
  },
  Withdrawn: (log) => {
    const {
      nullifierHash, to, relayer, fee,
    } = log.args;

    return {
      nullifierHash: BigInt(nullifierHash),
      to: BigInt(to),
      relayer: BigInt(relayer),
      fee,
      blockNumber: log.blockNumber,
      transactionHash: BigInt(log.transactionHash),
    };
  },
  RelayerRegistered: ({
    blockNumber, transactionHash, args: { relayer, relayerAddress, ensName, stakedAmount },
  }) => {
    return {
      blockNumber,
      transactionHash: BigInt(transactionHash),
      relayer: BigInt(relayer),
      ensName,
      relayerAddress: BigInt(relayerAddress),
      stakedAmount
    };
  },
  InstanceStateUpdated: ({
    blockNumber, transactionHash, args: {
      instance,
      state
    }
  }) => {
    return {
      blockNumber,
      transactionHash: BigInt(transactionHash),
      address: BigInt(instance),
      state: state as 0 | 1,
    };
  }
};

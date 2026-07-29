import { describe, expect, it, vi } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, toHex } from 'viem';
import type { ExternalRawEvent } from '@kohaku-eth/plugins';
import { DataService } from '../../src/data/data.service';
import {
  POOL_EVENTS_SIGNATURES,
  RELAYER_REGISTRY_EVENTS_SIGNATURES,
} from '../../src/data/abis/events.abi';

// DataService.parsePoolEvents turns the raw, hash-less events served by an
// ExternalSyncProvider (CanonicalEvent shape) into the plugin's pool events,
// reusing the same parse path as on-chain logs.
describe('DataService.parsePoolEvents', () => {
  const dataService = new DataService({
    provider: {} as unknown as ConstructorParameters<typeof DataService>[0]['provider'],
  });

  const POOL = '0x00000000000000000000000000000000000000aa' as const;

  const makeDeposit = (
    commitment: bigint,
    leafIndex: number,
    timestamp: bigint,
    blockNumber: bigint,
  ): ExternalRawEvent => {
    const topics = encodeEventTopics({
      abi: [POOL_EVENTS_SIGNATURES.Deposited],
      eventName: 'Deposit',
      args: { commitment: toHex(commitment, { size: 32 }) },
    });

    return {
      contractAddress: POOL,
      eventTopic: topics[0],
      topics,
      data: encodeAbiParameters(
        [{ type: 'uint32' }, { type: 'uint256' }],
        [leafIndex, timestamp],
      ),
      blockNumber: toHex(blockNumber),
      logIndex: toHex(0),
    };
  };

  const makeWithdrawal = (
    to: bigint,
    nullifierHash: bigint,
    relayer: bigint,
    fee: bigint,
    blockNumber: bigint,
  ): ExternalRawEvent => {
    const topics = encodeEventTopics({
      abi: [POOL_EVENTS_SIGNATURES.Withdrawn],
      eventName: 'Withdrawal',
      args: { relayer: toHex(relayer, { size: 20 }) },
    });

    return {
      contractAddress: POOL,
      eventTopic: topics[0],
      topics,
      data: encodeAbiParameters(
        [{ type: 'address' }, { type: 'bytes32' }, { type: 'uint256' }],
        [toHex(to, { size: 20 }), toHex(nullifierHash, { size: 32 }), fee],
      ),
      blockNumber: toHex(blockNumber),
      logIndex: toHex(1),
    };
  };

  it('parses raw deposit and withdrawal events, routing each by its topic', () => {
    const deposit = makeDeposit(0x1234n, 7, 1_700_000_000n, 100n);
    const withdrawal = makeWithdrawal(0xdeadn, 0xbeefn, 0xca11n, 500n, 101n);

    const { Deposited, Withdrawn } = dataService.parsePoolEvents([deposit, withdrawal]);

    expect(Deposited).toHaveLength(1);
    expect(Deposited[0]).toMatchObject({
      commitment: 0x1234n,
      leafIndex: 7,
      timestamp: 1_700_000_000n,
      blockNumber: 100n,
    });

    expect(Withdrawn).toHaveLength(1);
    expect(Withdrawn[0]).toMatchObject({
      to: 0xdeadn,
      nullifierHash: 0xbeefn,
      relayer: 0xca11n,
      fee: 500n,
      blockNumber: 101n,
    });
  });

  it('returns empty groups for no events (no provider calls needed)', () => {
    const spy = vi.spyOn(dataService, 'getPoolEvents');
    const { Deposited, Withdrawn } = dataService.parsePoolEvents([]);

    expect(Deposited).toEqual([]);
    expect(Withdrawn).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('parses raw relayer registry events', () => {
    const relayer = 0xa11ce7n;
    const relayerAddress = 0xdeadbeefn;
    const topics = encodeEventTopics({
      abi: [RELAYER_REGISTRY_EVENTS_SIGNATURES.RelayerRegistered],
      eventName: 'RelayerRegistered',
    });

    const raw: ExternalRawEvent = {
      contractAddress: '0x00000000000000000000000000000000000000bb',
      eventTopic: topics[0],
      topics,
      data: encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'string' }, { type: 'address' }, { type: 'uint256' }],
        [toHex(relayer, { size: 32 }), 'relayer.eth', toHex(relayerAddress, { size: 20 }), 40n],
      ),
      blockNumber: toHex(202),
      logIndex: toHex(0),
    };

    const { RelayerRegistered } = dataService.parseRelayerRegistryEvents([raw]);

    expect(RelayerRegistered).toHaveLength(1);
    expect(RelayerRegistered[0]).toMatchObject({
      relayer,
      ensName: 'relayer.eth',
      relayerAddress,
      stakedAmount: 40n,
      blockNumber: 202n,
    });
  });
});

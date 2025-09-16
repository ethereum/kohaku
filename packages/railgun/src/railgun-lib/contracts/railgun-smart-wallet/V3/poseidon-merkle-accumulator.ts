import { Contract, ContractEventPayload, FallbackProvider, Result } from 'ethers';
import EventEmitter from 'events';
import { Chain } from '../../../models/engine-types';
import { PollingJsonRpcProvider } from '../../../provider/polling-json-rpc-provider';
import { PoseidonMerkleAccumulator } from '../../../abi/typechain/PoseidonMerkleAccumulator';
import { ABIPoseidonMerkleAccumulator } from '../../../abi/abi';
import { ByteLength, ByteUtils } from '../../../utils/bytes';
import EngineDebug from '../../../debugger/debugger';
import { assertIsPollingProvider } from '../../../provider/polling-util';
import {
  EngineEvent,
  EventsCommitmentListener,
  EventsNullifierListener,
  EventsRailgunTransactionListenerV3,
  EventsUnshieldListener,
} from '../../../models/event-types';
import { TXIDVersion } from '../../../models/poi-types';
import { V3Events } from './V3-events';
import { promiseTimeout } from '../../../utils/promises';
import { recursivelyDecodeResult } from '../../../utils/ethers';
import { TypedContractEvent, TypedEventLog } from '../../../abi/typechain/common';
import { Nullifier } from '../../../models/formatted-types';

const SCAN_CHUNKS = 499;
const MAX_SCAN_RETRIES = 30;
const EVENTS_SCAN_TIMEOUT = 5000;
const SCAN_TIMEOUT_ERROR_MESSAGE = 'getLogs request timed out after 5 seconds.';

export class PoseidonMerkleAccumulatorContract extends EventEmitter {
  readonly contract: PoseidonMerkleAccumulator;

  readonly contractForListeners: PoseidonMerkleAccumulator;

  readonly address: string;

  readonly chain: Chain;

  readonly txidVersion = TXIDVersion.V3_PoseidonMerkle;

  private readonly eventTopic: string;

  constructor(
    address: string,
    provider: PollingJsonRpcProvider | FallbackProvider,
    pollingProvider: PollingJsonRpcProvider,
    chain: Chain,
  ) {
    super();
    this.address = address;
    this.contract = new Contract(
      address,
      ABIPoseidonMerkleAccumulator,
      provider,
    ) as unknown as PoseidonMerkleAccumulator;
    this.eventTopic = this.contract.getEvent('AccumulatorStateUpdate').getFragment().topicHash;
    this.chain = chain;

    // Because of a 'stallTimeout' bug in Ethers v6, all providers in a FallbackProvider will get called simultaneously.
    // So, we'll use a single json rpc (the first in the FallbackProvider) to poll for the event listeners.
    assertIsPollingProvider(pollingProvider);
    this.contractForListeners = new Contract(
      address,
      ABIPoseidonMerkleAccumulator,
      pollingProvider,
    ) as unknown as PoseidonMerkleAccumulator;
  }

  /**
   * Get current merkle root
   */
  async merkleRoot(): Promise<string> {
    return ByteUtils.hexlify(await this.contract.accumulatorRoot());
  }

  /**
   * Validates historical root
   */
  async validateMerkleroot(tree: number, root: string): Promise<boolean> {
    try {
      const isValidMerkleroot = await this.contract.rootHistory(
        tree,
        ByteUtils.formatToByteLength(root, ByteLength.UINT_256, true),
      );
      // if (!isValidMerkleroot && EngineDebug.isTestRun()) {
      //   EngineDebug.error(
      //     new Error(`[TEST] Last valid merkleroot: ${await this.contract.accumulatorRoot()}`),
      //   );
      // }
      return isValidMerkleroot;
    } catch (cause) {
      const err = new Error('Failed to validate V3 Poseidon merkleroot', { cause });
      EngineDebug.error(err);
      throw err;
    }
  }

  /**
   * Listens for update events.
   */
  async setTreeUpdateListeners(
    eventsCommitmentListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    eventsRailgunTransactionsV3Listener: EventsRailgunTransactionListenerV3,
    triggerWalletBalanceDecryptions: (txidVersion: TXIDVersion) => Promise<void>,
  ): Promise<void> {
    await this.contractForListeners.on(this.eventTopic as any, (event: ContractEventPayload) => {
      try {
        if (event.log.topics.length !== 1) {
          throw new Error('Requires one topic for railgun events');
        }

        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        V3Events.processAccumulatorEvent(
          this.txidVersion,
          event.args,
          event.log.transactionHash,
          event.log.blockNumber,
          eventsCommitmentListener,
          async (txidVersion: TXIDVersion, nullifiers: Nullifier[]) => {
            // eslint-disable-next-line @typescript-eslint/no-floating-promises
            eventsNullifierListener(txidVersion, nullifiers);
            this.emit(EngineEvent.ContractNullifierReceived, nullifiers);
          },
          eventsUnshieldListener,
          eventsRailgunTransactionsV3Listener,
          triggerWalletBalanceDecryptions,
        );
      } catch (err) {
        if (err instanceof Error) {
          EngineDebug.error(err);
        }
        if (EngineDebug.isTestRun()) {
          throw err;
        }
      }
    });
  }

  private async scanAllUpdateV3Events(
    startBlock: number,
    endBlock: number,
    retryCount = 0,
  ): Promise<TypedEventLog<TypedContractEvent<any, any, any>>[]> {
    try {
      const events = await promiseTimeout(
        this.contract.queryFilter(
          this.contract.filters.AccumulatorStateUpdate(),
          startBlock,
          endBlock,
        ),
        EVENTS_SCAN_TIMEOUT,
        SCAN_TIMEOUT_ERROR_MESSAGE,
      );
      const eventsWithDecodedArgs = events.map((event) => ({
        ...event,
        args: recursivelyDecodeResult(event.args as unknown as Result),
      }));
      return eventsWithDecodedArgs;
    } catch (cause) {
      if (!(cause instanceof Error)) {
        throw new Error('Non-error was thrown during scanAllUpdateV3Events', { cause });
      }
      const err = new Error('Failed to scan all V3 update events', { cause });
      if (retryCount < MAX_SCAN_RETRIES && cause.message === SCAN_TIMEOUT_ERROR_MESSAGE) {
        const retry = retryCount + 1;
        EngineDebug.log(
          `[Chain ${this.chain.type}:${
            this.chain.id
          }]: Scan query error at block ${startBlock}. Retrying ${MAX_SCAN_RETRIES - retry} times.`,
        );
        EngineDebug.error(err);
        return this.scanAllUpdateV3Events(startBlock, endBlock, retry);
      }
      EngineDebug.log(
        `[Chain ${this.chain.type}:${this.chain.id}]: Scan failed at block ${startBlock}. No longer retrying.`,
      );
      EngineDebug.error(err);
      throw err;
    }
  }

  /**
   * Gets historical events from block
   * @param startBlock - block to scan from
   * @param latestBlock - block to scan to
   */
  async getHistoricalEvents(
    initialStartBlock: number,
    latestBlock: number,
    getNextStartBlockFromValidMerkletree: () => Promise<number>,
    eventsCommitmentListener: EventsCommitmentListener,
    eventsNullifierListener: EventsNullifierListener,
    eventsUnshieldListener: EventsUnshieldListener,
    eventsRailgunTransactionsV3Listener: EventsRailgunTransactionListenerV3,
    setLastSyncedBlock: (lastSyncedBlock: number) => Promise<void>,
  ) {
    let currentStartBlock = initialStartBlock;

    const { txidVersion } = this;

    EngineDebug.log(
      `[Chain ${this.chain.type}:${this.chain.id}]: [${txidVersion}] Scanning historical events from block ${currentStartBlock} to ${latestBlock}`,
    );

    let startBlockForNext10000 = initialStartBlock;

    while (currentStartBlock < latestBlock) {
      // Process chunks of blocks for all events, serially.

      if ((currentStartBlock - startBlockForNext10000) % 10000 === 0) {
        EngineDebug.log(
          `[Chain ${this.chain.type}:${this.chain.id}]: [${txidVersion}] Scanning next 10,000 events [${currentStartBlock}]...`,
        );
      }

      const endBlock = Math.min(latestBlock, currentStartBlock + SCAN_CHUNKS);

      // eslint-disable-next-line no-await-in-loop
      const allUpdateV3EventLogs = await this.scanAllUpdateV3Events(currentStartBlock, endBlock);

      // eslint-disable-next-line no-await-in-loop
      await V3Events.processAccumulatorUpdateEvents(
        this.txidVersion,
        allUpdateV3EventLogs,
        eventsCommitmentListener,
        eventsNullifierListener,
        eventsUnshieldListener,
        eventsRailgunTransactionsV3Listener,
      );

      // eslint-disable-next-line no-await-in-loop
      await setLastSyncedBlock(endBlock);

      const nextStartBlockFromCurrentBlock = currentStartBlock + SCAN_CHUNKS + 1;
      const nextStartBlockFromLatestValidMerkletreeEntry =
        // eslint-disable-next-line no-await-in-loop
        await getNextStartBlockFromValidMerkletree();

      // Choose greater of:
      // 1. currentStartBlock + scan chunk size
      // 2. Latest verified merkletree block
      // This optimizes the slow scan in case quicksync returns a single invalid merkleroot for a given block.
      // The other data is queued for merkletree, and will validate and enter the merkletree, providing a new starting block.
      // This skips slow scan for those intermediary blocks.
      if (nextStartBlockFromLatestValidMerkletreeEntry > nextStartBlockFromCurrentBlock) {
        currentStartBlock = nextStartBlockFromLatestValidMerkletreeEntry;
        startBlockForNext10000 = nextStartBlockFromLatestValidMerkletreeEntry;
        EngineDebug.log(
          `[Chain ${this.chain.type}:${this.chain.id}]: Skipping ${
            nextStartBlockFromCurrentBlock - nextStartBlockFromLatestValidMerkletreeEntry
          } already processed/validated blocks from QuickSync...`,
        );
      } else {
        currentStartBlock = nextStartBlockFromCurrentBlock;
      }
    }

    EngineDebug.log(`[Chain ${this.chain.type}:${this.chain.id}]: Finished historical event scan`);
  }

  /**
   * Remove all listeners and shutdown contract instance
   */
  async unload() {
    await this.contract.removeAllListeners();
    await this.contractForListeners?.removeAllListeners();
  }
}

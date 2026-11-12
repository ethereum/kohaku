import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IAspFlaggedDeposit, IAspReviewService } from '../../src/data/asp.interface';
import type { Address } from '../../src/interfaces/types.interface';
import { myHistoryEventsSelector } from '../../src/state/selectors/history.selector';
import { allNotesSelector, unapprovedNotesSelector } from '../../src/state/selectors/notes.selector';
import { registerAspTree } from '../../src/state/slices/aspSlice';
import { setAspFlaggedDeposits } from '../../src/state/slices/aspReviewSlice';
import { registerDeposits } from '../../src/state/slices/depositsSlice';
import { registerEntrypointDeposits } from '../../src/state/slices/entrypointDepositsSlice';
import { registerPools } from '../../src/state/slices/poolsSlice';
import { addUserSecret } from '../../src/state/slices/userSecretsSlice';
import { storeFactory } from '../../src/state/store';
import { ASP_REVIEW_TIMEOUT_MS, syncAspReviewThunk } from '../../src/state/thunks/syncAspReviewThunk';
import { TEST_STORE_DEV_OPTIONS } from '../utils/common';

const pool = 1000n as Address;
const otherPool = 1001n as Address;
const asset = 2000n as Address;
const depositor = 3000n as Address;

const deposit = (n: bigint) => ({
  pool, depositor, commitment: n * 10n + 1n, label: n * 10n, precommitment: n, value: 100n,
  blockNumber: 150_000n + n, transactionHash: 0xa0n + n, logIndex: 0,
});

// A: in the ASP tree. B, C: outside it.
const depositA = deposit(1n);
const depositB = deposit(2n);
const depositC = deposit(3n);

const setupStore = ({ approved = [depositA], withSecrets = true }: { approved?: ReturnType<typeof deposit>[]; withSecrets?: boolean } = {}) => {
  const store = storeFactory({
    logLevel: 'off',
    devOptions: TEST_STORE_DEV_OPTIONS,
    entrypointInfo: { chainId: 1n, entrypointAddress: 900n as Address, deploymentBlock: 100_000n },
  });
  const deposits = [depositA, depositB, depositC];

  store.dispatch(registerPools([{ address: pool, asset, scope: 1n, registeredBlock: 100_000n, woundDownAtBlock: null }]));
  store.dispatch(registerAspTree({ leaves: approved.map(({ label }) => label), aspTreeRoot: 1n, blockNumber: 1n }));
  store.dispatch(registerDeposits(deposits));
  store.dispatch(registerEntrypointDeposits(deposits.map(({ commitment, blockNumber, transactionHash }) => ({
    depositor, poolAddress: pool, commitment, blockNumber, transactionHash,
  }))));

  if (withSecrets) {
    deposits.forEach(({ precommitment }, depositIndex) => store.dispatch(addUserSecret({
      depositIndex,
      noteSecrets: [{ noteIndex: 0, nullifier: 0n, salt: 0n, precommitment, nullifierHash: precommitment + 500n }],
    })));
  }

  return store;
};

const reviewService = (flagged: IAspFlaggedDeposit[] | Error): IAspReviewService & { calls: number } => {
  const service = {
    calls: 0,
    getFlaggedDeposits: async () => {
      service.calls++;

      if (flagged instanceof Error) throw flagged;

      return flagged;
    },
  };

  return service;
};

const statusOf = (store: ReturnType<typeof setupStore>) =>
  Object.fromEntries(allNotesSelector(store.getState()).map(({ precommitment, reviewStatus }) => [precommitment.toString(), reviewStatus]));

describe('ASP review status', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reads pending for every deposit outside the tree without a review service', async () => {
    const store = setupStore();

    await store.dispatch(syncAspReviewThunk({}));

    expect(statusOf(store)).toEqual({ 1: 'approved', 2: 'pending', 3: 'pending' });
  });

  it('labels the deposits the feed flagged', async () => {
    const store = setupStore();

    await store.dispatch(syncAspReviewThunk({ aspReviewService: reviewService([
      { precommitment: 2n, pool, status: 'declined' },
      { precommitment: 3n, pool, status: 'poi_required' },
    ]) }));

    expect(statusOf(store)).toEqual({ 1: 'approved', 2: 'declined', 3: 'poi_required' });
    expect(unapprovedNotesSelector(store.getState()).map(({ reviewStatus }) => reviewStatus)).toEqual(['declined', 'poi_required']);

    const history = myHistoryEventsSelector(store.getState());

    expect(history.map((e) => e.type === 'deposit' && e.aspStatus)).toEqual(['approved', 'declined', 'poi_required']);
  });

  it('keeps a deposit in the ASP tree approved whatever the feed says', async () => {
    const store = setupStore();

    await store.dispatch(syncAspReviewThunk({ aspReviewService: reviewService([
      { precommitment: 1n, pool, status: 'declined' },
    ]) }));

    expect(statusOf(store)[1]).toBe('approved');
  });

  it('ignores flags for pools of another entrypoint', async () => {
    const store = setupStore();

    await store.dispatch(syncAspReviewThunk({ aspReviewService: reviewService([
      { precommitment: 2n, pool: otherPool, status: 'declined' },
    ]) }));

    expect(statusOf(store)[2]).toBe('pending');
  });

  it('drops a decline the ASP reverted', async () => {
    const store = setupStore();

    store.dispatch(setAspFlaggedDeposits([[2n, 'declined']]));
    await store.dispatch(syncAspReviewThunk({ aspReviewService: reviewService([]) }));

    expect(statusOf(store)[2]).toBe('pending');
  });

  it('keeps the last known statuses when the feed fails, without failing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = setupStore();

    store.dispatch(setAspFlaggedDeposits([[2n, 'declined']]));
    const result = await store.dispatch(syncAspReviewThunk({ aspReviewService: reviewService(new Error('503')) }));

    expect(result.meta.requestStatus).toBe('fulfilled');
    expect(statusOf(store)[2]).toBe('declined');
  });

  it('gives up on a feed that never answers, keeping the last statuses', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = setupStore();
    let signal: AbortSignal | undefined;
    // Ignores the signal, like a custom service could.
    const stalled: IAspReviewService = {
      getFlaggedDeposits: (params) => {
        signal = params.signal;

        return new Promise(() => {});
      },
    };

    store.dispatch(setAspFlaggedDeposits([[2n, 'declined']]));
    const pending = store.dispatch(syncAspReviewThunk({ aspReviewService: stalled }));

    await vi.advanceTimersByTimeAsync(ASP_REVIEW_TIMEOUT_MS);
    const result = await pending;

    expect(result.meta.requestStatus).toBe('fulfilled');
    expect(signal?.aborted).toBe(true);
    expect(statusOf(store)[2]).toBe('declined');
  });

  it('leaves the shared list alone without a service', async () => {
    const store = setupStore();

    store.dispatch(setAspFlaggedDeposits([[2n, 'declined']]));
    await store.dispatch(syncAspReviewThunk({}));

    expect(store.getState().aspReview.flaggedTuples).toHaveLength(1);
  });

  it('asks the feed from the shared chain state, which holds no account notes', async () => {
    const store = setupStore({ withSecrets: false });
    const service = reviewService([{ pool, precommitment: depositB.precommitment, status: 'declined' }]);

    await store.dispatch(syncAspReviewThunk({ aspReviewService: service }));

    expect(service.calls).toBe(1);
    expect(store.getState().aspReview.flaggedTuples).toHaveLength(1);
  });
});

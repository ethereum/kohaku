import { describe, expect, it } from 'vitest';
import { OxBowAspReviewService, OxBowReviewEvent } from '../../src/data/0xbowAspReview.service';
import { createFailingFetch, createMockFetch, createTrackedMockFetch } from '../utils/mock-fetch';

const CHAIN_ID = 1n;
const POOL = '0xF241d57C6DebAe225c0F2e6eA1529373C9A9C9fB';

const event = (precommitment: number, reviewStatus: string, overrides: Partial<OxBowReviewEvent> = {}): OxBowReviewEvent => ({
  eventId: precommitment,
  precommitmentHash: precommitment.toString(),
  reviewStatus,
  pool: { chainId: CHAIN_ID.toString(), poolAddress: POOL },
  ...overrides,
});

const page = (events: OxBowReviewEvent[], total = events.length) => ({ json: { page: 0, perPage: 100, total, events } });

describe('OxBowAspReviewService', () => {
  it('fetches declined and poi_required deposits for the chain', async () => {
    const tracked = createTrackedMockFetch({
      responses: new Map([
        ['status=declined', page([event(1, 'declined'), event(2, 'declined')])],
        ['status=poi_required', page([event(3, 'poi_required')])],
      ]),
    });
    const service = new OxBowAspReviewService({ network: { fetch: tracked.fetch } });

    const flagged = await service.getFlaggedDeposits({ chainId: CHAIN_ID });

    expect(flagged).toEqual([
      { precommitment: 1n, pool: BigInt(POOL), status: 'declined' },
      { precommitment: 2n, pool: BigInt(POOL), status: 'declined' },
      { precommitment: 3n, pool: BigInt(POOL), status: 'poi_required' },
    ]);
    expect(tracked.calls).toHaveLength(2);

    for (const { url } of tracked.calls) {
      expect(url).toContain('https://api.0xbow.io/global/public/events?action=deposit');
      expect(url).toContain('chainId=1');
      expect(url).toContain('perPage=100');
      expect(url).toContain('page=1');
      // The whole chain's list, never a lookup of one deposit.
      expect(url).not.toContain('precommitment');
    }
  });

  it('follows pages until the total is reached', async () => {
    const full = Array.from({ length: 100 }, (_, i) => event(i + 1, 'declined'));
    const tracked = createTrackedMockFetch({
      responses: new Map([
        ['status=declined&chainId=1&perPage=100&page=1', page(full, 150)],
        ['status=declined&chainId=1&perPage=100&page=2', page([event(101, 'declined')], 150)],
        ['status=poi_required', page([])],
      ]),
    });
    const service = new OxBowAspReviewService({ network: { fetch: tracked.fetch } });

    const flagged = await service.getFlaggedDeposits({ chainId: CHAIN_ID });

    expect(flagged).toHaveLength(101);
    expect(tracked.calls.filter(({ url }) => url.includes('status=declined'))).toHaveLength(2);
  });

  it('skips rows of another chain or another status', async () => {
    const fetch = createMockFetch({
      responses: new Map([
        ['status=declined', page([
          event(1, 'declined'),
          event(2, 'declined', { pool: { chainId: '10', poolAddress: POOL } }),
          event(3, 'approved'),
        ])],
        ['status=poi_required', page([])],
      ]),
    });
    const service = new OxBowAspReviewService({ network: { fetch } });

    expect(await service.getFlaggedDeposits({ chainId: CHAIN_ID })).toEqual([
      { precommitment: 1n, pool: BigInt(POOL), status: 'declined' },
    ]);
  });

  it('uses a custom aspUrl', async () => {
    const tracked = createTrackedMockFetch({
      responses: new Map([['status=', page([])]]),
    });
    const service = new OxBowAspReviewService({ network: { fetch: tracked.fetch }, aspUrl: 'https://asp.example.com' });

    await service.getFlaggedDeposits({ chainId: CHAIN_ID });

    expect(tracked.calls[0]!.url).toMatch(/^https:\/\/asp\.example\.com\/global\/public\/events/);
  });

  it('throws on an HTTP error', async () => {
    const fetch = createMockFetch({ responses: new Map([['status=', { json: {}, status: 503 }]]) });
    const service = new OxBowAspReviewService({ network: { fetch } });

    await expect(service.getFlaggedDeposits({ chainId: CHAIN_ID })).rejects.toThrow('returned 503');
  });

  it('throws on a malformed row', async () => {
    const fetch = createMockFetch({
      responses: new Map([['status=', page([event(1, 'declined', { precommitmentHash: '0xabc' })])]]),
    });
    const service = new OxBowAspReviewService({ network: { fetch } });

    await expect(service.getFlaggedDeposits({ chainId: CHAIN_ID })).rejects.toThrow('Unexpected response');
  });

  it('passes the abort signal to every request', async () => {
    const tracked = createTrackedMockFetch({ responses: new Map([['status=', page([])]]) });
    const service = new OxBowAspReviewService({ network: { fetch: tracked.fetch } });
    const { signal } = new AbortController();

    await service.getFlaggedDeposits({ chainId: CHAIN_ID, signal });

    expect(tracked.calls).toHaveLength(2);
    expect(tracked.calls.every(({ init }) => init?.signal === signal)).toBe(true);
  });

  it('throws on a network error', async () => {
    const service = new OxBowAspReviewService({ network: { fetch: createFailingFetch(new Error('offline')) } });

    await expect(service.getFlaggedDeposits({ chainId: CHAIN_ID })).rejects.toThrow('offline');
  });
});

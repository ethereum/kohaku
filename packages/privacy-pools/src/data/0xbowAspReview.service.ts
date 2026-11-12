import { Network } from "@kohaku-eth/plugins";
import { getNumber } from "ethers";

import { AspFlaggedStatus, IAspFlaggedDeposit, IAspReviewService, IAspServiceParams } from "./asp.interface.js";

const FLAGGED_STATUSES: readonly AspFlaggedStatus[] = ['declined', 'poi_required'];
// The API's maximum.
const PER_PAGE = 100;
// Bounds a misbehaving API; the feed holds ~100 declined deposits today.
const MAX_PAGES = 50;

export type OxBowReviewEvent = {
  eventId: number;
  precommitmentHash: string;
  reviewStatus: string;
  pool: { chainId: string; poolAddress: string; };
};

export type OxBowEventsResponse = {
  total: number;
  events: OxBowReviewEvent[];
};

const isDecimal = (x: unknown): x is string => typeof x === 'string' && /^\d+$/.test(x);
const isHexAddress = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x);

function isEventsResponse(x: unknown): x is OxBowEventsResponse {
  const _x = x as OxBowEventsResponse;

  return typeof _x?.total === 'number' &&
    Array.isArray(_x.events) &&
    _x.events.every((e) =>
      isDecimal(e?.precommitmentHash) &&
      typeof e.reviewStatus === 'string' &&
      isDecimal(e.pool?.chainId) &&
      isHexAddress(e.pool?.poolAddress)
    );
}

export interface OxBowAspReviewServiceParams extends IAspServiceParams {
  aspUrl?: string;
}

/**
 * Reads 0xBow's public events feed. Each status is fetched whole for the chain,
 * never per deposit, so 0xBow doesn't learn which deposits belong to the user.
 */
export class OxBowAspReviewService implements IAspReviewService {
  private aspUrl = "https://api.0xbow.io";
  private fetch: Network["fetch"];

  constructor({ network: { fetch }, aspUrl }: OxBowAspReviewServiceParams) {
    this.fetch = fetch;

    if (aspUrl) {
      this.aspUrl = aspUrl;
    }
  }

  private async getEventsPage(
    chainId: bigint, status: AspFlaggedStatus, page: number, signal?: AbortSignal,
  ): Promise<OxBowEventsResponse> {
    const url = `${this.aspUrl}/global/public/events?action=deposit&status=${status}` +
      `&chainId=${getNumber(chainId)}&perPage=${PER_PAGE}&page=${page}`;
    const response = await this.fetch(url, { method: "GET", signal });

    if (!response.ok) {
      throw new Error(`ASP review feed returned ${response.status} for ${url}`);
    }

    const raw: unknown = await response.json();

    if (!isEventsResponse(raw)) {
      throw new Error(`Unexpected response from ${url}`);
    }

    return raw;
  }

  private async getFlaggedByStatus(
    chainId: bigint, status: AspFlaggedStatus, signal?: AbortSignal,
  ): Promise<IAspFlaggedDeposit[]> {
    const flagged: IAspFlaggedDeposit[] = [];

    // Pages start at 1. Rows come newest first, so a deposit flagged mid-scan shifts
    // the rest down and shows up twice; callers key by precommitment.
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { total, events } = await this.getEventsPage(chainId, status, page, signal);

      for (const event of events) {
        if (event.reviewStatus !== status || BigInt(event.pool.chainId) !== chainId) continue;

        flagged.push({
          precommitment: BigInt(event.precommitmentHash),
          pool: BigInt(event.pool.poolAddress),
          status,
        });
      }

      if (events.length < PER_PAGE || page * PER_PAGE >= total) break;
    }

    return flagged;
  }

  async getFlaggedDeposits({ chainId, signal }: { chainId: bigint; signal?: AbortSignal }): Promise<IAspFlaggedDeposit[]> {
    const byStatus = await Promise.all(
      FLAGGED_STATUSES.map((status) => this.getFlaggedByStatus(chainId, status, signal)),
    );

    return byStatus.flat();
  }
}

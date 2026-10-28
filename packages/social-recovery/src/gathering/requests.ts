import { GATHERING_REQUEST_KIND, GATHERING_REQUEST_VERSION } from '../constants';
import { setupBodyHash } from '../formats/commitments';
import type { ApproverRequest, Gathering } from '../interfaces';
import { assertGatheringRead } from './edge';

/**
 * One request per place, each carrying that place's credential alone, the body as its hash and no label.
 * The pinned block and the attempt's spendable moment stay in the record. Throws on a record this build does not read.
 */
export function requests(record: Gathering): ApproverRequest[] {
  assertGatheringRead(record);

  const { request } = record;
  const bodyHash = setupBodyHash(request.setupBody);

  return record.places.map((entry) => {
    const shared = {
      kind: GATHERING_REQUEST_KIND,
      version: GATHERING_REQUEST_VERSION,
      chainId: request.chainId,
      manager: request.manager,
      digestVersion: request.digestVersion,
      account: request.account,
      action: request.action,
      attemptId: request.attemptId,
      setupNonce: request.setupNonce,
      setupBodyHash: bodyHash,
      validUntil: request.validUntil,
      place: entry.place,
      method: entry.method,
      config: entry.config,
      salt: entry.salt,
      credentialHoldsCode: entry.credentialHoldsCode,
    } as const;

    if (record.purpose === 'cancellation') {
      return { ...shared, purpose: record.purpose };
    }

    return { ...shared, purpose: record.purpose, payload: record.request.payload, order: { ...record.request.order } };
  });
}

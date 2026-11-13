import { beforeEach } from 'vitest';
import { forgetPinnedPairs } from '../../src/method-aadhaar/artifacts';
import { forgetPeerBinding } from '../../src/method-aadhaar/peer-binding';

/** Starts every test of the calling file as on a new page: no checked bucket pair kept and no files bound to the peer. */
export function newPagePerTest(): void {
  beforeEach(() => {
    forgetPinnedPairs();
    forgetPeerBinding();
  });
}

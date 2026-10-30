import { getAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import { describeRequest, walletMethod, type Address, type ApproverRequest, type Hex } from '../../src/index';
import {
  approvalFromVector,
  cancellationFromVector,
  codecRegistry,
  describingMethod,
  handoverRows,
  lenientCodec,
  lyingCodec,
  MANAGER,
  methodRegistry,
  strictCodec,
  ZERO,
} from './request-fixtures';
import { flipping, OTHER_HANDOVER, OTHER_PAIR } from '../methods-orchestrator/flipping';

const FACTS = { kind: 'external-proving-app', app: 'fixture' } as const;

const approval = approvalFromVector();
const cancellation = cancellationFromVector();
const { canonical, pair, trailing } = handoverRows();
const withPayload = (payload: Hex): ApproverRequest => ({ ...approval, payload } as ApproverRequest);
const registered = () => describingMethod(FACTS);
const methodsFor = (request: ApproverRequest) => methodRegistry([[request.method, registered().method]]);

describe('describeRequest copies the request members', () => {
  it('carries the blessed opening row\'s account, chain, manager, action, ids, window and place', () => {
    const description = describeRequest(approval, codecRegistry(), methodsFor(approval));

    expect(description).toMatchObject({
      account: getAddress('0x1111111111111111111111111111111111111111'),
      chainId: 11_155_111,
      manager: getAddress(MANAGER),
      action: getAddress('0x2222222222222222222222222222222222222222'),
      attemptId: 9n,
      setupNonce: 7n,
      purpose: 'approval',
      validUntil: 1_800_000_000,
      place: 0,
    });
  });

  it('carries the blessed cancellation row the same way with purpose cancellation', () => {
    const description = describeRequest(cancellation, codecRegistry(), methodsFor(cancellation));

    expect(description).toMatchObject({ attemptId: 9n, setupNonce: 7n, purpose: 'cancellation', validUntil: 1_800_000_000, place: 0 });
  });

  it('reads attempt ids and nonces past the safe-integer range exactly', () => {
    const big = { ...approval, attemptId: '18446744073709551615', setupNonce: '9007199254740993' } as ApproverRequest;
    const description = describeRequest(big, codecRegistry(), methodsFor(big));

    expect(description.attemptId).toBe(18_446_744_073_709_551_615n);
    expect(description.setupNonce).toBe(9_007_199_254_740_993n);
  });

  it('publishes the credential\'s method and config with the fact of the salt, never the salt itself', () => {
    const description = describeRequest(approval, codecRegistry(), methodsFor(approval));

    expect(description.identityPublic).toEqual({ method: getAddress(approval.method), config: approval.config, saltPublished: true });
    expect(JSON.stringify(description, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value))).not.toContain(
      approval.salt.slice(2),
    );
  });
});

describe('describeRequest decodes the handover through the codec the action selects', () => {
  it('shows both keys when the payload decodes and re-encodes to the very same bytes', () => {
    const request = withPayload(canonical);
    const description = describeRequest(request, codecRegistry(strictCodec([request.action])), methodsFor(request));

    expect(description.handover).toEqual({
      decoded: true,
      newAuthority: getAddress(pair.newAuthority),
      removedAuthority: getAddress(pair.removedAuthority ?? ZERO),
    });
  });

  it('reports no-codec when no codec serves the request\'s action, even if one serves another action', () => {
    const request = withPayload(canonical);
    const other: Address = '0x2222222222222222222222222222222222222229';

    expect(describeRequest(request, codecRegistry(), methodsFor(request)).handover).toEqual({ decoded: false, cause: 'no-codec' });
    expect(describeRequest(request, codecRegistry(strictCodec([other])), methodsFor(request)).handover).toEqual({
      decoded: false,
      cause: 'no-codec',
    });
  });

  it('reports round-trip-failed when the codec refuses the blessed opening row\'s three-byte payload', () => {
    const description = describeRequest(approval, codecRegistry(strictCodec([approval.action])), methodsFor(approval));

    expect(description.handover).toEqual({ decoded: false, cause: 'round-trip-failed' });
  });

  it('reports round-trip-failed for a lenient codec that decodes the trailing-byte payload to honest-looking keys', () => {
    const request = withPayload(trailing);
    const description = describeRequest(request, codecRegistry(lenientCodec([request.action])), methodsFor(request));

    expect(description.handover).toEqual({ decoded: false, cause: 'round-trip-failed' });
  });

  it('reports round-trip-failed when the codec\'s encoding of what it decoded differs from the payload', () => {
    const request = withPayload(canonical);
    const codec = lyingCodec([request.action], pair);

    expect(describeRequest(request, codecRegistry(codec), methodsFor(request)).handover).toEqual({ decoded: false, cause: 'round-trip-failed' });
  });

  it('decodes the same canonical bytes when the payload arrives in upper-case hex', () => {
    const request = withPayload(`0x${canonical.slice(2).toUpperCase()}`);
    const description = describeRequest(request, codecRegistry(strictCodec([request.action])), methodsFor(request));

    expect(description.handover).toMatchObject({ decoded: true });
  });
});

describe('describeRequest describes the order', () => {
  it('names the blessed row\'s token, amount and payee', () => {
    expect(describeRequest(approval, codecRegistry(), methodsFor(approval)).order).toEqual({
      token: getAddress('0x4444444444444444444444444444444444444444'),
      amount: 1_234_567_890_123_456_789n,
      payee: getAddress('0x5555555555555555555555555555555555555555'),
    });
  });

  it('shows the zero payee as open', () => {
    const open = { ...approval, order: { token: ZERO, amount: '0', payee: ZERO } } as ApproverRequest;

    expect(describeRequest(open, codecRegistry(), methodsFor(open)).order).toEqual({ token: ZERO, amount: 0n, payee: 'open' });
  });

  it('leaves both handover and order out of a cancellation, even with a codec for its action', () => {
    const description = describeRequest(cancellation, codecRegistry(strictCodec([cancellation.action])), methodsFor(cancellation));

    expect('handover' in description).toBe(false);
    expect('order' in description).toBe(false);
  });
});

describe('describeRequest reads the device facts from the method registry', () => {
  it('returns the registered implementation\'s describe answer, handed a frozen copy of this request and its place', () => {
    const { method, seen } = registered();
    const description = describeRequest(approval, codecRegistry(), methodRegistry([[approval.method, method]]));

    expect(description.device).toEqual(FACTS);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.request).toEqual(approval);
    expect(seen[0]?.request).not.toBe(approval);
    expect(Object.isFrozen(seen[0]?.request)).toBe(true);
    expect(seen[0]?.place).toBe(approval.place);
  });

  it('builds the ctx itself: a 32-byte digest and typed data whose primary type follows the purpose', () => {
    for (const [request, primaryType] of [[approval, 'Approval'], [cancellation, 'Cancellation']] as const) {
      const { method, seen } = registered();

      describeRequest(request, codecRegistry(), methodRegistry([[request.method, method]]));

      expect(seen[0]?.digest).toMatch(/^0x[0-9a-f]{64}$/);
      expect(seen[0]?.typedData.primaryType).toBe(primaryType);
      expect(seen[0]?.typedData.domain).toMatchObject({ name: 'PolicyManager', chainId: 11_155_111, verifyingContract: getAddress(MANAGER) });
    }
  });

  it('answers no-implementation when no implementation serves the method', () => {
    const elsewhere: Address = '0x3333333333333333333333333333333333333339';

    expect(describeRequest(approval, codecRegistry(), methodRegistry([])).device).toBe('no-implementation');
    expect(describeRequest(approval, codecRegistry(), methodRegistry([[elsewhere, registered().method]])).device).toBe('no-implementation');
  });

  it('carries the shipped wallet method\'s facts for a guardian credential', () => {
    const guardian: Address = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';
    const config: Hex = '0x0000000000000000000000007e5f4552091a69125d5dfcb7b8c2659029395bdf';
    const request = { ...approval, config, credentialHoldsCode: true } as ApproverRequest;
    const device = describeRequest(request, codecRegistry(), methodRegistry([[request.method, walletMethod()]])).device;

    expect(device).toMatchObject({ kind: 'typed-data-wallet', holdsCode: true });
    expect(String(device !== 'no-implementation' && device['guardian']).toLowerCase()).toBe(guardian.toLowerCase());
  });
});

describe('describeRequest is pure', () => {
  it('returns equal descriptions for equal inputs and leaves the request untouched', () => {
    const before = structuredClone(approval);
    const codecs = codecRegistry(strictCodec([approval.action]));
    const methods = methodsFor(approval);

    expect(describeRequest(approval, codecs, methods)).toEqual(describeRequest(approval, codecs, methods));
    expect(approval).toEqual(before);
  });
});

describe('describeRequest describes the copy it checked, not the caller\'s object read again', () => {
  it('a payload that changes after its first read: the handover shown is the one the digest was built over', () => {
    const request = flipping(withPayload(canonical), 'payload', canonical, OTHER_HANDOVER);
    const { method, seen } = registered();
    const description = describeRequest(request, codecRegistry(strictCodec([approval.action])), methodRegistry([[approval.method, method]]));

    expect(description.handover).toEqual({
      decoded: true,
      newAuthority: getAddress(pair.newAuthority),
      removedAuthority: getAddress(pair.removedAuthority ?? ZERO),
    });
    expect(description.handover).not.toMatchObject({ newAuthority: getAddress(OTHER_PAIR.newAuthority) });
    expect((seen[0]?.request as { payload?: Hex } | undefined)?.payload).toBe(canonical.toLowerCase());
  });

  it('a purpose that turns into cancellation after its first read still describes an approval with its handover and order', () => {
    const request = flipping(withPayload(canonical), 'purpose', 'approval', 'cancellation');
    const { method, seen } = registered();
    const description = describeRequest(request, codecRegistry(strictCodec([approval.action])), methodRegistry([[approval.method, method]]));

    expect(description.purpose).toBe('approval');
    expect(description.handover).toMatchObject({ decoded: true });
    expect('order' in description).toBe(true);
    expect(seen[0]?.typedData.primaryType).toBe('Approval');
  });

  it('a purpose that turns into approval after its first read still describes a cancellation, never a throw', () => {
    const request = flipping(withPayload(canonical), 'purpose', 'cancellation', 'approval');
    const { method, seen } = registered();
    const description = describeRequest(request, codecRegistry(strictCodec([approval.action])), methodRegistry([[approval.method, method]]));

    expect(description.purpose).toBe('cancellation');
    expect('handover' in description).toBe(false);
    expect('order' in description).toBe(false);
    expect(seen[0]?.typedData.primaryType).toBe('Cancellation');
  });
});

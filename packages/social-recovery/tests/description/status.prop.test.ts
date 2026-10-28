import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ATTEMPT_STATES, describeStatus, type Address, type Hex, type KitNotification, type RecoveryState, type SetupState, type StatusScope } from '../../src/index';
import { address, bytesN, TIMEOUT, run, uint } from '../formats/arbitraries';
import { at, HOLDER } from './status-fixtures';

const hash = fc.oneof(fc.constant<Hex>(`0x${'1a'.repeat(32)}`), bytesN(32));
const block = fc.record({ number: fc.nat(1_000_000), timestamp: fc.nat(2 ** 40), hash });
const methods = fc.uniqueArray(address, { maxLength: 4, selector: (method) => method.toLowerCase() });

const attempt = fc.record({
  attemptId: fc.oneof(uint(64), fc.constant(5n)),
  setupNonce: uint(64),
  consumableAfter: fc.nat(2 ** 48 - 1),
  state: fc.constantFrom(...ATTEMPT_STATES),
  payloadHash: bytesN(32),
  order: fc.record({ token: address, amount: uint(256), payee: address }),
  usedMethods: methods,
  ignoresPause: fc.boolean(),
});

const setupState: fc.Arbitrary<SetupState> = fc.record({
  isAuthorized: fc.boolean(),
  hasSetup: fc.boolean(),
  setupCommitment: bytesN(32),
  setupNonce: uint(64),
  setupCommittedAtBlock: fc.nat(1_000_000),
  attemptActive: fc.boolean(),
  block,
});

const recoveryState: fc.Arbitrary<RecoveryState> = fc.record({
  attempt,
  nextAttemptId: uint(64),
  setupCommitment: bytesN(32),
  setupNonce: uint(64),
  removedKey: fc.constant('unread' as const),
  block,
});

const notification = (pool: readonly Address[], scope: StatusScope): fc.Arbitrary<KitNotification> => {
  const near = (value: Address) => fc.oneof(fc.constant(value), fc.constant(value.toUpperCase().replace('0X', '0x') as Address), address);
  const method = pool.length === 0 ? address : fc.oneof(fc.constantFrom(...pool), address);
  const position = fc.tuple(fc.nat(1_000), fc.nat(50)).map(([number, index]) => at(number, index));

  return fc.oneof(
    fc.record({ kind: fc.constantFrom('method-paused' as const, 'method-unpaused' as const), method, by: fc.constant(HOLDER), at: position }),
    fc.record({
      kind: fc.constant('attempt-started' as const),
      account: near(scope.account),
      action: near(scope.action),
      attemptId: fc.oneof(uint(64), fc.constant(5n)),
      setupNonce: uint(64),
      setupBody: bytesN(8),
      usedPlaces: fc.array(fc.bigInt({ min: 0n, max: 255n }), { maxLength: 4 }),
      usedMethods: methods,
      payload: bytesN(64),
      order: fc.record({ token: address, amount: uint(256), payee: address }),
      consumableAfter: fc.nat(2 ** 48 - 1),
      at: position,
    }),
  );
};

const scopes: fc.Arbitrary<StatusScope> = fc.record({ account: address, action: address });

const inputs = fc
  .tuple(setupState, recoveryState, scopes)
  .chain(([setup, recovery, scope]) =>
    fc.array(notification(recovery.attempt.usedMethods, scope), { maxLength: 8 }).map((latest) => ({ setup, recovery, latest, scope })),
  );

describe('describeStatus over arbitrary consistent records', () => {
  it('never throws and keeps block, armed, setup, attempt and stops tied to their sources', () => {
    run(fc.property(inputs, ({ setup, recovery, latest, scope }) => {
      const description = describeStatus(setup, recovery, latest, scope);
      const same = setup.block.hash.toLowerCase() === recovery.block.hash.toLowerCase();

      expect(description.block.sameBlock).toBe(same);
      expect(description.armed).toBe(setup.isAuthorized);
      expect(description.setup).toEqual({
        setupCommitment: setup.setupCommitment,
        setupNonce: setup.setupNonce,
        setupCommittedAtBlock: setup.setupCommittedAtBlock,
      });

      if (recovery.attempt.state === 'None') {
        expect(description.attempt).toBeUndefined();
        expect(description.stops).toEqual([]);

        return;
      }

      expect(description.attempt?.attemptId).toBe(recovery.attempt.attemptId);
      expect(description.stops.map((stop) => stop.method.toLowerCase())).toEqual(recovery.attempt.usedMethods.map((m) => m.toLowerCase()));

      const sameAddress = (left: Address, right: Address): boolean => left.toLowerCase() === right.toLowerCase();
      const own = latest.filter(
        (event) =>
          event.kind === 'attempt-started' &&
          event.attemptId === recovery.attempt.attemptId &&
          sameAddress(event.account, scope.account) &&
          sameAddress(event.action, scope.action),
      );

      expect(description.attempt !== undefined && 'payload' in description.attempt).toBe(own.length > 0);

      for (const stop of description.stops) {
        if (stop.latest !== undefined) expect(stop.latest.method.toLowerCase()).toBe(stop.method.toLowerCase());
      }
    }));
  }, TIMEOUT);
});

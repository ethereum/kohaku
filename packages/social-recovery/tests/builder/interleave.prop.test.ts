import fc from 'fast-check';
import { getAddress } from 'viem';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BUILDER_FROZEN_MESSAGE,
  BUILDER_PENDING_MESSAGE,
  KitRefusalError,
  SocialRecoveryBuilder,
  type ManagerReading,
} from '../../src/index';
import {
  ACTION,
  FC_PARAMS,
  GatedDouble,
  MAINNET,
  TIMEOUT,
  actionStub,
  attempt,
  codecServing,
  eventsStub,
  holder,
  managerStub,
  methodServing,
  goodWorld,
  signerRecoveryStub,
  type ChainWorld,
} from './doubles';

type Builder = ReturnType<typeof SocialRecoveryBuilder.from<ReturnType<typeof holder>>>;

const SETTERS = [
  'withPolicyManager',
  'withEventManager',
  'withEventManagerOptions',
  'withRecoveryAction',
  'withCodec',
  'withCodecOptions',
  'withMethod',
  'withSignerRecovery',
  'withVersionEscape',
  'withManagerReading',
] as const;

const BUILDS = ['build', 'buildSetupClient', 'buildRecoveryClient', 'buildMethodsOrchestrator', 'recoveryAction', 'methodModuleReads'] as const;

const CHECKED = BUILDS.filter((name) => name !== 'buildMethodsOrchestrator');

type Outcome = 'ok' | 'refuse' | 'transport';

type Step =
  | { readonly kind: 'set'; readonly name: (typeof SETTERS)[number] }
  | { readonly kind: 'build'; readonly name: (typeof BUILDS)[number]; readonly outcome: Outcome }
  | { readonly kind: 'pending'; readonly name: (typeof CHECKED)[number]; readonly setter: (typeof SETTERS)[number]; readonly outcome: Outcome };

const TRANSPORT = new Error('connection reset');

/** The world a build meets: a good one, a provider on another chain, or a provider that cannot answer. */
const worldOf = (outcome: Outcome): ChainWorld =>
  outcome === 'ok' ? goodWorld() : { ...goodWorld(), chainId: outcome === 'refuse' ? MAINNET : { rejects: TRANSPORT } };

let READING: ManagerReading;

beforeAll(async () => {
  const builder = SocialRecoveryBuilder.from(holder());

  await builder.buildSetupClient();
  READING = builder.managerReading()!;
});

/** A fresh address per call, so added methods and codecs never collide. */
const fresh = (counter: { value: number }) => getAddress(`0x${(0xf000 + (counter.value += 1)).toString(16).padStart(40, '0')}`);

function set(builder: Builder, name: (typeof SETTERS)[number], counter: { value: number }): unknown {
  switch (name) {
    case 'withPolicyManager':
      return builder.withPolicyManager(managerStub());
    case 'withEventManager':
      return builder.withEventManager(eventsStub());
    case 'withEventManagerOptions':
      return builder.withEventManager({ logChunkSize: 1 + counter.value });
    case 'withRecoveryAction':
      return builder.withRecoveryAction(ACTION, actionStub());
    case 'withCodec':
      return builder.withCodec(codecServing(fresh(counter)));
    case 'withCodecOptions':
      return builder.withCodec({ actions: [fresh(counter)] });
    case 'withMethod':
      return builder.withMethod(methodServing([fresh(counter)]));
    case 'withSignerRecovery':
      return builder.withSignerRecovery(signerRecoveryStub());
    case 'withVersionEscape':
      return builder.withVersionEscape();
    case 'withManagerReading':
      return builder.withManagerReading(READING);
  }
}

/** The instances one build hands out, flattened so a bundle compares member by member. */
async function run(builder: Builder, name: (typeof BUILDS)[number]): Promise<readonly unknown[]> {
  const result = await builder[name]();

  return name === 'build' ? Object.values(result as object) : [result];
}

const outcomeArbitrary = fc.constantFrom<Outcome>('ok', 'refuse', 'transport');

const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  fc.constantFrom(...SETTERS).map((name): Step => ({ kind: 'set', name })),
  fc.record({ name: fc.constantFrom(...BUILDS), outcome: outcomeArbitrary }).map((step): Step => ({ kind: 'build', ...step })),
  fc.record({ name: fc.constantFrom(...CHECKED), setter: fc.constantFrom(...SETTERS), outcome: outcomeArbitrary }).map(
    (step): Step => ({ kind: 'pending', ...step }),
  ),
);

/** The message of the TypeError a setter throws; fails the property when it does not throw one. */
function refusalOf(step: () => unknown): string {
  try {
    step();
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(TypeError);

    return (thrown as TypeError).message;
  }

  throw new Error('the setter was accepted');
}

/** What the model of one builder knows: whether a build succeeded, whether the chain was judged, and how many chain-id reads it owes. */
type Model = { frozen: boolean; judged: boolean; chainReads: number; readonly seen: Map<string, readonly unknown[]> };

/** Settles one build against the model: a success is memoized and freezes, a failure caches nothing. */
async function settle(builder: Builder, name: (typeof BUILDS)[number], outcome: Outcome, started: Promise<readonly unknown[]>, model: Model) {
  const reads = name !== 'buildMethodsOrchestrator' && !model.judged;
  const succeeds = !reads || outcome === 'ok';
  let instances: readonly unknown[] | undefined;
  let thrown: unknown;

  try {
    instances = await started;
  } catch (failure) {
    thrown = failure;
  }

  if (reads) model.chainReads += 1;

  if (!succeeds) {
    if (outcome === 'refuse') expect(thrown).toBeInstanceOf(KitRefusalError);
    else expect(thrown).toBe(TRANSPORT);

    expect(builder.managerReading()).toBeUndefined();

    return;
  }

  expect(thrown).toBeUndefined();

  const first = model.seen.get(name);

  if (first === undefined) model.seen.set(name, instances!);
  else instances!.forEach((instance, place) => expect(instance).toBe(first[place]));

  model.frozen = true;

  if (reads) model.judged = true;

  if (model.judged) expect(builder.managerReading()).toBeDefined();
}

describe('setter and build interleavings', () => {
  it(
    'accept setters until a build succeeds, refuse them while one runs, and memoize only successful builds',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(stepArbitrary, { minLength: 1, maxLength: 10 }), async (steps) => {
          const provider = new GatedDouble();
          const builder = SocialRecoveryBuilder.from(holder(provider));
          const counter = { value: 0 };
          const model: Model = { frozen: false, judged: false, chainReads: 0, seen: new Map() };

          for (const step of steps) {
            if (step.kind === 'set') {
              if (model.frozen) expect(refusalOf(() => set(builder, step.name, counter))).toBe(BUILDER_FROZEN_MESSAGE);
              else expect(set(builder, step.name, counter)).toBe(builder);

              continue;
            }

            provider.world = worldOf(step.outcome);

            if (step.kind === 'build') {
              await settle(builder, step.name, step.outcome, attempt(() => run(builder, step.name)), model);

              continue;
            }

            provider.hold();

            const started = attempt(() => run(builder, step.name));

            started.catch(() => undefined);

            const message = refusalOf(() => set(builder, step.setter, counter));

            if (model.frozen) expect([BUILDER_PENDING_MESSAGE, BUILDER_FROZEN_MESSAGE]).toContain(message);
            else expect(message).toBe(BUILDER_PENDING_MESSAGE);

            provider.release();
            await settle(builder, step.name, step.outcome, started, model);
          }

          expect(provider.managerCalls()).toBeLessThanOrEqual(2);
          expect(provider.reads.filter((read) => read === 'chainId').length).toBe(model.chainReads);
        }),
        FC_PARAMS,
      );
    },
    TIMEOUT,
  );
});

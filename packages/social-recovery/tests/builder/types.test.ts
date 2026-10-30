import { describe, expect, it } from 'vitest';
import { SocialRecoveryBuilder, type SocialRecoveryApproverInputs, type SocialRecoveryHolderInputs } from '../../src/index';
import { ACCOUNT, ChainDouble, DESCRIPTOR, SEPOLIA, failureOf } from './doubles';

describe('the builder types', () => {
  it('refuse a client build on an approver builder at compile time and at run time', async () => {
    const approver = SocialRecoveryBuilder.from({ descriptor: DESCRIPTOR });

    // @ts-expect-error an approver builder builds no client
    expect(await failureOf(() => approver.build())).toBeInstanceOf(TypeError);
    // @ts-expect-error an approver builder builds no client
    expect(await failureOf(() => approver.buildSetupClient())).toBeInstanceOf(TypeError);
    // @ts-expect-error an approver builder builds no client
    expect(await failureOf(() => approver.buildRecoveryClient())).toBeInstanceOf(TypeError);
    // @ts-expect-error an approver builder hands out no action part
    expect(await failureOf(() => approver.recoveryAction())).toBeInstanceOf(TypeError);
    // @ts-expect-error an approver builder hands out no module views
    expect(await failureOf(() => approver.methodModuleReads())).toBeInstanceOf(TypeError);
    expect(() => approver.buildMethodsOrchestrator()).not.toThrow();
  });

  it('refuse an approver built from a chain id alone a client build at compile time', async () => {
    const approver = SocialRecoveryBuilder.from({ chainId: SEPOLIA });

    // @ts-expect-error an approver builder builds no client
    expect(await failureOf(() => approver.buildSetupClient())).toBeInstanceOf(TypeError);
  });

  it('refuse inputs naming neither a descriptor nor a chain id, or half a holder, at compile time', () => {
    // @ts-expect-error one of descriptor and chainId is required
    expect(() => SocialRecoveryBuilder.from({}).buildMethodsOrchestrator()).toThrow(TypeError);
    // @ts-expect-error one of descriptor and chainId is required
    expect(() => SocialRecoveryBuilder.from({ deviceBindings: ['none'] }).buildMethodsOrchestrator()).toThrow(TypeError);
    // @ts-expect-error a holder needs an account
    expect(() => SocialRecoveryBuilder.from({ provider: new ChainDouble(), descriptor: DESCRIPTOR })).toThrow(TypeError);
  });

  it('accept the holder and approver shapes', () => {
    const holderInputs: SocialRecoveryHolderInputs = { provider: new ChainDouble(), account: ACCOUNT };
    const approverInputs: SocialRecoveryApproverInputs = { chainId: SEPOLIA };

    expect(SocialRecoveryBuilder.from(holderInputs)).toBeInstanceOf(SocialRecoveryBuilder);
    expect(SocialRecoveryBuilder.from(approverInputs)).toBeInstanceOf(SocialRecoveryBuilder);
  });

  it('refuse the static build of an approver at compile time', async () => {
    // @ts-expect-error the one-call build is a holder's
    expect(await failureOf(() => SocialRecoveryBuilder.build({ descriptor: DESCRIPTOR }))).toBeInstanceOf(TypeError);
  });

  it('default the generic to the holder shape: an annotated holder builder builds, an annotated approver does not compile', async () => {
    const holderInputs: SocialRecoveryHolderInputs = { provider: new ChainDouble(), account: ACCOUNT, descriptor: DESCRIPTOR };
    const holderBuilder: SocialRecoveryBuilder = SocialRecoveryBuilder.from(holderInputs);
    const kit = await holderBuilder.build();

    expect(kit.setupClient).toBe(await holderBuilder.buildSetupClient());

    // @ts-expect-error the default builder is a holder's, and an approver's inputs are not
    const approverBuilder: SocialRecoveryBuilder = SocialRecoveryBuilder.from({ chainId: 1 });

    expect(approverBuilder).toBeInstanceOf(SocialRecoveryBuilder);
  });
});

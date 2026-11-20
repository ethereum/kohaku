import { describe, expect, it, vi } from 'vitest';

import { checkDepositor, PPv1DepositorCheckError } from '../../src/plugin/depositor-check';
import { PrivacyPoolsV1Protocol } from '../../src/plugin/base';
import { IStateManager } from '../../src/plugin/interfaces/protocol-params.interface';
import { createMockHost } from '../utils/mock-host';

const ASSET = { __type: 'erc20', contract: '0x00000000000000000000000000000000000000aa' } as const;
const DEPOSITOR = '0x00000000000000000000000000000000000000dd';
const OTHER = '0x00000000000000000000000000000000000000bb';

const note = (depositor: bigint | undefined) => ({
  assetAddress: BigInt(ASSET.contract),
  balance: 10n,
  approved: true,
  depositor,
});

function setup(notes: ReturnType<typeof note>[]) {
  const withdrawalPayload = { kind: 'payload' };
  const stateManager = {
    sync: vi.fn(async () => {}),
    getNotes: vi.fn(async () => notes),
    getWithdrawalPayloads: vi.fn(async () => [withdrawalPayload]),
  };
  const pools = new PrivacyPoolsV1Protocol(createMockHost(), {
    entrypoint: { address: 1n, deploymentBlock: 0n },
    stateManager: () => stateManager as unknown as IStateManager,
  });

  // Skip relayer assembly: it needs a real proof, which is not under test here.
  const assemble = vi
    .spyOn(pools as unknown as { assembleRelayerOperation: (r: unknown) => unknown }, 'assembleRelayerOperation')
    .mockImplementation(() => ({ mode: 'relayer' }));

  return { pools, stateManager, assemble };
}

const amount = { asset: ASSET, amount: 1n };

describe('checkDepositor', () => {
  const asset = BigInt(ASSET.contract);

  it('flags a recipient that matches a spendable note depositor', () => {
    expect(checkDepositor([note(BigInt(DEPOSITOR))], asset, BigInt(DEPOSITOR)).status).toBe('recipient-is-depositor');
  });

  it('is ok when the recipient differs', () => {
    expect(checkDepositor([note(BigInt(DEPOSITOR))], asset, BigInt(OTHER))).toEqual({ status: 'ok' });
  });

  it('ignores spent, unapproved and other-asset notes', () => {
    const d = BigInt(DEPOSITOR);

    expect(checkDepositor([{ ...note(d), balance: 0n }, { ...note(d), approved: false }, { ...note(d), assetAddress: 1n }], asset, d))
      .toEqual({ status: 'ok' });
  });

  it('skips with a warning when a note has no depositor', () => {
    const result = checkDepositor([note(undefined)], asset, BigInt(OTHER));

    expect(result).toMatchObject({ status: 'skipped', warning: { code: 'depositor-unknown' } });
  });
});

describe('prepareUnshield depositor check', () => {
  it('warn mode: throws until confirmed, then proceeds with the warning attached', async () => {
    const { pools, assemble } = setup([note(BigInt(DEPOSITOR))]);

    await expect(pools.prepareUnshield(amount, DEPOSITOR)).rejects.toThrow(PPv1DepositorCheckError);
    await expect(pools.prepareUnshield(amount, DEPOSITOR, { depositorCheck: { mode: 'warn' } }))
      .rejects.toMatchObject({ mode: 'warn', warning: { code: 'recipient-is-depositor' } });
    expect(assemble).not.toHaveBeenCalled();

    const operation = await pools.prepareUnshield(amount, DEPOSITOR, { depositorCheck: { confirmed: true } });

    expect(assemble).toHaveBeenCalledOnce();
    expect(operation.warnings).toEqual([expect.objectContaining({ code: 'recipient-is-depositor' })]);
  });

  it('block mode: rejects even when confirmed', async () => {
    const { pools, assemble } = setup([note(BigInt(DEPOSITOR))]);

    await expect(pools.prepareUnshield(amount, DEPOSITOR, { depositorCheck: { mode: 'block', confirmed: true } }))
      .rejects.toMatchObject({ name: 'PPv1DepositorCheckError', mode: 'block' });
    expect(assemble).not.toHaveBeenCalled();
  });

  it('leaves the behavior unchanged when the recipient differs', async () => {
    const { pools, stateManager } = setup([note(BigInt(DEPOSITOR))]);

    const operation = await pools.prepareUnshield(amount, OTHER, { depositorCheck: { mode: 'block' } });

    expect(operation).toEqual({ mode: 'relayer' });
    expect(operation.warnings).toBeUndefined();
    expect(stateManager.getWithdrawalPayloads).toHaveBeenCalledOnce();
  });

  it('skips the check with a warning when a note has no depositor', async () => {
    const { pools } = setup([note(undefined)]);

    const operation = await pools.prepareUnshield(amount, DEPOSITOR, { depositorCheck: { mode: 'block' } });

    expect(operation.warnings).toEqual([expect.objectContaining({ code: 'depositor-unknown' })]);
  });
});

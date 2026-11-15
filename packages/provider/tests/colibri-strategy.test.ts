import { beforeEach, describe, expect, it, vi } from 'vitest';
import { colibri } from '../src/colibri';

const mocks = vi.hoisted(() => {
    const strategies = {
        VerifiedOnly: () => Promise.resolve('verified-only'),
        VerifyIfPossible: () => Promise.resolve('verify-if-possible'),
        WarningWithFallback: () => Promise.resolve('warning-with-fallback'),
    };

    return { strategies, configs: [] as Record<string, unknown>[] };
});

vi.mock('@corpus-core/colibri-stateless', () => ({
    Strategy: mocks.strategies,
    default: class {
        constructor(config: Record<string, unknown>) {
            mocks.configs.push(config);
        }

        request = vi.fn();
    },
}));

describe('colibri adapter proof strategy', () => {
    beforeEach(() => {
        mocks.configs.length = 0;
    });

    it('fails closed by default: VerifiedOnly', async () => {
        await colibri({ chainId: 1 });

        expect(mocks.configs[0]?.proofStrategy).toBe(mocks.strategies.VerifiedOnly);
    });

    it('keeps a strategy the caller chose', async () => {
        await colibri({ chainId: 1, proofStrategy: mocks.strategies.WarningWithFallback });

        expect(mocks.configs[0]?.proofStrategy).toBe(mocks.strategies.WarningWithFallback);
    });

    it('keeps the existing defaults', async () => {
        await colibri({ chainId: 1 });

        expect(mocks.configs[0]).toMatchObject({ zk_proof: true, verifyTransactions: false });
    });
});

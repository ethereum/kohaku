import { setSignEntropy } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { SignatureSecretManager } from '../../src/account/signature-keys';
import { createMockHost } from '../utils/mock-host';

// viem cannot switch sign entropy back off, so this lives in its own file
// (vitest isolates modules per file).
describe('SignatureSecretManager with viem sign entropy on', () => {
  it('refuses to derive secrets from the default keystore signer', async () => {
    setSignEntropy(true);

    const m = SignatureSecretManager({ host: createMockHost(), accountIndex: 0 });

    await expect(
      m.getDepositSecrets({ entrypointAddress: 0x34a2068192b1297f2a7f85d7d8cde66f8f0921cbn, chainId: 11155111n, depositIndex: 0 }),
    ).rejects.toThrow('Note signer is not deterministic');
  });
});

import { MemoryStorage, MnemonicKeystore, type Host } from '@kohaku-eth/plugins';
import { viem } from '@kohaku-eth/provider/viem';
import { createPublicClient, http } from 'viem';

export const MNEMONIC_A = 'test test test test test test test test test test test junk';
export const MNEMONIC_B = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

export function createHost(args: { rpcUrl: string; mnemonic: string; fetch?: typeof fetch }): Host {
  return {
    keystore: new MnemonicKeystore(args.mnemonic),
    network: { fetch: args.fetch ?? fetch },
    storage: new MemoryStorage(),
    provider: viem(createPublicClient({ transport: http(args.rpcUrl), cacheTime: 0 })),
  };
}

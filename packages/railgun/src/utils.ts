import { HDKey } from '@scure/bip32';
import { mnemonicToSeed } from "@scure/bip39";

export async function deriveKeysFromMnemonic(
    mnemonic: string,
    accountIndex: number
): Promise<{ spendingKey: `0x${string}`; viewingKey: `0x${string}`; }> {
    const seed = await mnemonicToSeed(mnemonic);
    const key = HDKey.fromMasterSeed(seed);

    const { spendingPath, viewingPath } = derivationPaths(accountIndex);
    const spendingKey = key.derive(spendingPath).privateKey;
    const viewingKey = key.derive(viewingPath).privateKey;

    if (!spendingKey || !viewingKey) {
        throw new Error("Failed to derive keys from mnemonic");
    }

    return {
        spendingKey: `0x${Buffer.from(spendingKey).toString('hex')}`,
        viewingKey: `0x${Buffer.from(viewingKey).toString('hex')}`,
    }
}

export function derivationPaths(accountIndex: number): { spendingPath: string; viewingPath: string } {
    return {
        spendingPath: `m/44'/1984'/0'/0'/${accountIndex}'`,
        viewingPath: `m/420'/1984'/0'/0'/${accountIndex}'`,
    };
}

export const STATE_KEY = "railgun-plugin-state";

export interface RailgunPluginState {
    providerState: string, // base64-encoded provider state
    internalSigners: {
        spendingKey: `0x${string}`,
        viewingKey: `0x${string}`,
    }[],
    chainId: bigint,
    version: '0.1.0',
}

export const STATE_KEY = "railgun-plugin-state";

export interface RailgunPluginState {
    providerState: Uint8Array,
    internalSigners: {
        spendingKey: `0x${string}`,
        viewingKey: `0x${string}`,
    }[],
    chainId: number,
    version: '0.1.0',
}

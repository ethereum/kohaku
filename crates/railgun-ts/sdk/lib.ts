import initWasm from "../pkg";
export * from '../pkg/index';
export { EthereumProviderAdapter } from "./ethereum-provider.js";
export { DatabaseAdapter } from "./database.js";
export type { RailgunPlugin, RailgunPluginConfig, BundlerConfig } from "./plugin.js";
export { createRailgunPlugin } from "./plugin.js";

let initPromise: Promise<void> | null = null;

export function ensureInitialized(wasmInput?: BufferSource | Response): Promise<void> {
    if (!initPromise) initPromise = _init(wasmInput);
    return initPromise;
}

async function _init(wasmInput?: BufferSource | Response): Promise<void> {
    if (!wasmInput && typeof process !== 'undefined') {
        const { readFile } = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join } = await import('node:path');
        const dir = dirname(fileURLToPath(import.meta.url));
        wasmInput = new Uint8Array(await readFile(join(dir, '../pkg/index_bg.wasm')));
    }
    await initWasm(wasmInput !== undefined ? { module_or_path: wasmInput } : undefined);
}

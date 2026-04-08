import init from './pkg/railgun_rs.js';

let initialized = false;

export async function initialize(wasmInput?: BufferSource | Response) {
    if (initialized) return;

    if (!wasmInput && typeof process !== 'undefined') {
        // Node: read from disk
        const { readFile } = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');
        const { dirname, join } = await import('node:path');
        const dir = dirname(fileURLToPath(import.meta.url));
        wasmInput = new Uint8Array(await readFile(join(dir, 'pkg/railgun_rs_bg.wasm')));
    }

    if (wasmInput !== undefined) {
        await init({ module_or_path: wasmInput });
    } else {
        await init();
    }
    initialized = true;
}

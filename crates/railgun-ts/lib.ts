import initWasm from "./pkg";
export * from './pkg/index'

let initPromise: Promise<any> | null = null;

async function ensureInitialized() {
    if (!initPromise) {
        initPromise = initWasm();
    }
    await initPromise;
}

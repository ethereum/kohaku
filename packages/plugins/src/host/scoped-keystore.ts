import type { Hex } from "ox/Hex";
import type { Keystore } from "./index";
import { parseDerivationPath } from "./derivation-path";

export type KeystoreScope = {
    /** Subtrees the holder may derive below, e.g. `m/29795'/1'`. The prefix node itself is not included. */
    prefixes: readonly string[];
    /**
     * Single paths allowed on top of the subtrees, e.g. a wallet-path delegator.
     * Read on every call, so a `Set` the caller keeps can grow later.
     */
    paths?: readonly string[] | ReadonlySet<string>;
};

export class KeystorePathNotAllowedError extends Error {
    constructor(path: string) {
        super(`Keystore path not allowed for this plugin: ${path}`);
        this.name = "KeystorePathNotAllowedError";
    }
}

const samePath = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

function parsesTo(path: string, indices: number[]): boolean {
    try {
        return samePath(parseDerivationPath(path), indices);
    } catch {
        return false;
    }
}

/**
 * Wraps a keystore so it only derives paths below `scope.prefixes` or equal to
 * one of `scope.paths`; anything else throws {@link KeystorePathNotAllowedError}.
 * Give each plugin its own scoped keystore. The returned object only has
 * `deriveAt`, so plugin code holding it cannot reach the wrapped keystore.
 */
export function scopeKeystore(keystore: Keystore, { prefixes, paths = [] }: KeystoreScope): Keystore {
    const subtrees = prefixes.map(parseDerivationPath);
    const allowed = (indices: number[]) =>
        subtrees.some((prefix) => indices.length > prefix.length && prefix.every((v, i) => v === indices[i]))
        || [...paths].some((path) => parsesTo(path, indices));

    return Object.freeze({
        async deriveAt(path: string): Promise<Hex> {
            if (!allowed(parseDerivationPath(path))) throw new KeystorePathNotAllowedError(path);

            return keystore.deriveAt(path);
        },
    });
}

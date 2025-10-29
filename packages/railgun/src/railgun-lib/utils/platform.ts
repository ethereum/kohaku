// Centralized environment + crypto selection helpers
// Prevents brittle "is object" checks that fail under bundlers

// Node 'crypto' may be aliased to false or stubbed by bundlers.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as nodeCrypto from 'crypto';

export type NodeCiphers = Pick<typeof import('crypto'), 'createCipheriv' | 'createDecipheriv'>;
export type NodeRandomBytes = Pick<typeof import('crypto'), 'randomBytes'>;

/**
 * Checks if Web Crypto API is available.
 * True in modern browsers, false in Node.js (unless polyfilled).
 */
export const hasWebCrypto =
  typeof globalThis !== 'undefined' &&
  !!(globalThis as any).crypto &&
  typeof (globalThis as any).crypto.subtle?.importKey === 'function';

/**
 * Checks if Node.js cipher functions are available.
 * True in Node.js, false in browser builds (where crypto is stubbed to false).
 */
export const hasNodeCiphers =
  !!(nodeCrypto as any) &&
  typeof (nodeCrypto as any).createCipheriv === 'function' &&
  typeof (nodeCrypto as any).createDecipheriv === 'function';

/**
 * Checks if Node.js randomBytes is available.
 * True in Node.js, false in browser builds.
 */
export const hasNodeRandomBytes =
  !!(nodeCrypto as any) && typeof (nodeCrypto as any).randomBytes === 'function';

/**
 * Prefer browser crypto if available; only use Node ciphers when truly present.
 * In a browser build, hasWebCrypto will be true and hasNodeCiphers will be false.
 * In Node.js, hasWebCrypto will be false and hasNodeCiphers will be true.
 */
export const useBrowserCrypto = hasWebCrypto && !hasNodeCiphers;

/**
 * Returns Node.js cipher functions if available, throws otherwise.
 * Use this instead of direct imports to ensure Node crypto is actually available.
 */
export const getNodeCiphers = (): NodeCiphers => {
  if (!hasNodeCiphers) {
    throw new Error('Node crypto ciphers not available in this environment');
  }
  return nodeCrypto as unknown as NodeCiphers;
};

/**
 * Returns Node.js randomBytes if available, throws otherwise.
 * Use this instead of direct imports to ensure Node crypto is actually available.
 */
export const getNodeRandomBytes = (): NodeRandomBytes => {
  if (!hasNodeRandomBytes) {
    throw new Error('Node crypto randomBytes not available in this environment');
  }
  return nodeCrypto as unknown as NodeRandomBytes;
};

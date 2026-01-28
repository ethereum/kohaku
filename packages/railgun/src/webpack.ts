/* eslint-disable */
// @ts-nocheck
/// <reference path="./webpack.d.ts" />
import './webpack.d.ts';
// A safe browser shim for Node's `fs` module.
// Provides browser-safe implementations for file operations using an in-memory cache.

// In-memory file cache for browser environment
const fileCache = new Map<string, string | Buffer>();

// Cache of pending fetches to avoid duplicate requests
const pendingFetches = new Map<string, Promise<Buffer>>();

/**
 * Register a file in the browser file cache.
 * This allows readFileSync to work in browser environments.
 *
 * @param path - File path (exact path as used by the npm package, e.g., "//1x2/zkey.br")
 * @param content - File content as string or Buffer
 */
export function registerFile(path: string, content: string | Buffer): void {
  fileCache.set(path, content);
}

/**
 * Remove a file from the browser file cache.
 *
 * @param path - File path to remove
 */
export function unregisterFile(path: string): void {
  fileCache.delete(path);
}

/**
 * Clear all files from the browser file cache.
 */
export function clearFileCache(): void {
  fileCache.clear();
}

/**
 * Check if a file exists in the cache.
 *
 * @param path - File path to check
 * @returns true if the file exists in cache
 */
export function fileExists(path: string): boolean {
  return fileCache.has(path);
}

/**
 * Extract artifact path from npm package path.
 * Example: "//1x2/zkey.br" -> "assets/circuits/1x2/zkey.br"
 */
function extractArtifactPath(path: string): string | null {
  // Handle paths like "//1x2/zkey.br" (from empty __dirname)
  if (path.startsWith('//')) {
    const artifactPath = path.slice(2); // Remove "//"

    return artifactPath ? `assets/circuits/${artifactPath}` : null;
  }

  // Handle paths like "/1x2/zkey.br"
  if (path.startsWith('/')) {
    const match = path.match(/^\/(\d+x\d+\/.+)$/);
    const artifactPath = match && match[1] ? match[1] : null;

    return artifactPath ? `assets/circuits/${artifactPath}` : null;
  }

  return null;
}

/**
 * Synchronously fetch a file using XMLHttpRequest.
 * This is the only way to do truly synchronous network requests in browsers.
 */
function fetchFileSync(assetUrl: string): Buffer {
  // Check if there's already a pending fetch - wait for it
  const existingPromise = pendingFetches.get(assetUrl);

  if (existingPromise) {
    // Wait for the existing promise to resolve by polling the cache
    const startTime = Date.now();
    const timeout = 30000; // 30 second timeout

    while (!fileCache.has(assetUrl)) {
      if (Date.now() - startTime > timeout) {
        throw new Error(`Timeout waiting for file to load: ${assetUrl}`);
      }

      // Small delay to allow async operations to progress
      // In practice, this will be very fast since the fetch is already in progress
      const end = Date.now() + 1;

      while (Date.now() < end) {
        // Busy wait for 1ms
      }
    }

    const cached = fileCache.get(assetUrl);

    if (cached === undefined) {
      throw new Error(`File not found after fetch: ${assetUrl}`);
    }

    if (cached instanceof Buffer) {
      return cached;
    }

    // cached is a string at this point, convert to Buffer
    if (typeof cached === 'string') {
      return Buffer.from(cached, 'utf8');
    }

    // Fallback (should never happen)
    throw new Error(`Unexpected cache value type for ${assetUrl}`);
  }

  // Use synchronous XMLHttpRequest for truly synchronous behavior
  // Note: This is deprecated but necessary for synchronous file reading
  // Cannot set responseType on synchronous XHR, so we use responseText and convert
  // overrideMimeType must be called before open() to treat response as binary
  const xhr = new XMLHttpRequest();

  xhr.overrideMimeType('text/plain; charset=x-user-defined');
  xhr.open('GET', assetUrl, false); // false = synchronous

  try {
    xhr.send(null);

    if (xhr.status !== 200 && xhr.status !== 0) {
      throw new Error(`Failed to fetch ${assetUrl}: ${xhr.status} ${xhr.statusText}`);
    }

    // For synchronous XHR, we can't use responseType, so we use responseText
    // Convert the binary string to a Buffer
    const responseText = xhr.responseText;

    if (!responseText || responseText.length === 0) {
      throw new Error(`No data received for ${assetUrl}`);
    }

    // Convert binary string to Buffer
    // Each character in responseText is a byte (0-255)
    const bytes = new Uint8Array(responseText.length);

    for (let i = 0; i < responseText.length; i++) {
      bytes[i] = responseText.charCodeAt(i) & 0xff;
    }
    const buffer = Buffer.from(bytes);

    // Register in cache
    registerFile(assetUrl, buffer);

    return buffer;
  } catch (error) {
    throw new Error(`Failed to synchronously fetch ${assetUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Preload an artifact file from the webpack-bundled assets.
 * This should be called before using artifacts to ensure files are in the cache.
 *
 * @param nullifiers - Number of nullifiers (e.g., 1)
 * @param commitments - Number of commitments (e.g., 2)
 * @param filename - Filename (e.g., 'zkey.br', 'wasm.br', 'vkey')
 * @returns Promise that resolves when the file is loaded and cached
 */
// export async function preloadArtifactFile(
//   nullifiers: number,
//   commitments: number,
//   filename: string
// ): Promise<void> {
//   // The npm package uses paths like "//1x2/zkey.br" when __dirname is empty
//   const cachePath = `//${nullifiers}x${commitments}/${filename}`;
//   const assetPath = `${nullifiers}x${commitments}/${filename}`;
//   const assetUrl = `assets/circuits/${assetPath}`;

//   // If already in cache, return immediately
//   if (fileCache.has(cachePath)) {
//     return;
//   }

//   // Fetch and register the file
//   await fetchAndRegisterFile(cachePath, assetUrl);
// }

// /**
//  * Preload all artifact files for a given circuit configuration.
//  *
//  * @param nullifiers - Number of nullifiers
//  * @param commitments - Number of commitments
//  * @returns Promise that resolves when all files are loaded
//  */
// export async function preloadArtifactFiles(
//   nullifiers: number,
//   commitments: number
// ): Promise<void> {
//   const files = ['zkey.br', 'wasm.br', 'vkey'];
//   await Promise.all(
//     files.map(filename => preloadArtifactFile(nullifiers, commitments, filename))
//   );
// }

function notSupported(name: string): never {
  throw new Error(`fs.${name} is not supported in the browser`);
}

// Browser-safe readFileSync implementation
// Matches Node.js fs.readFileSync signature
export function readFileSync(path: string, encoding?: BufferEncoding): string | Buffer | undefined {
  // Check cache with exact path
  const artifactPath = extractArtifactPath(path);

  if (!artifactPath) {
    throw new Error(`Invalid path: ${path}`);
  }

  console.log('artifactPath:', artifactPath);
  let content = fileCache.get(artifactPath);

  if (content === undefined) {
    // Fetch synchronously
    const buffer = fetchFileSync(artifactPath);

    content = buffer;
  }

  // If encoding is specified, always return string (matches Node.js behavior)
  if (encoding) {
    if (typeof content === 'string') {
      return content;
    } else {
      // Buffer to string with specified encoding
      return content.toString(encoding);
    }
  }

  // If no encoding specified, return Buffer (or convert string to Buffer)
  if (typeof content === 'string') {
    // Convert string to Buffer for consistency with Node.js behavior
    return Buffer.from(content, 'utf8');
  }

  return content;
}

export const readFile = (..._args: any[]) => notSupported("readFile");

export const writeFile = (..._args: any[]) => notSupported("writeFile");
export const writeFileSync = (..._args: any[]) => notSupported("writeFileSync");

// Browser-safe existsSync implementation
export function existsSync(path: string): boolean {
  return fileCache.has(path);
}

export const mkdir = (..._args: any[]) => notSupported("mkdir");
export const mkdirSync = (..._args: any[]) => notSupported("mkdirSync");

export const readdir = (..._args: any[]) => notSupported("readdir");
export const readdirSync = (..._args: any[]) => notSupported("readdirSync");

export const stat = (..._args: any[]) => notSupported("stat");
export const statSync = (..._args: any[]) => notSupported("statSync");

export const unlink = (..._args: any[]) => notSupported("unlink");
export const unlinkSync = (..._args: any[]) => notSupported("unlinkSync");

// Some libraries try to access promises API
export const promises = {
  readFile: (..._args: any[]) => notSupported("promises.readFile"),
  writeFile: (..._args: any[]) => notSupported("promises.writeFile"),
  readdir: (..._args: any[]) => notSupported("promises.readdir"),
  stat: (..._args: any[]) => notSupported("promises.stat"),
  unlink: (..._args: any[]) => notSupported("promises.unlink"),
};

// Default export matches Node style
export default {
  readFile,
  readFileSync,
  writeFile,
  writeFileSync,
  existsSync,
  mkdir,
  mkdirSync,
  readdir,
  readdirSync,
  stat,
  statSync,
  unlink,
  unlinkSync,
  promises,
  // Browser-specific utilities
  registerFile,
  unregisterFile,
  clearFileCache,
  fileExists,
};

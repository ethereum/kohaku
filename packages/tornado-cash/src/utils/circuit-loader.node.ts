import { readFile } from 'fs/promises';
import { resolve } from 'path';

// This module is compiled to CJS — __dirname is the Node.js CJS global for the
// current file's directory. Declared here because the TS source is treated as ESM.
declare const __dirname: string;

export async function loadCircuitFiles(circuitUrl?: string, provingKeyUrl?: string) {
  if (circuitUrl || provingKeyUrl) {
    console.warn('[circuit-loader.node] circuitUrl and provingKeyUrl are ignored in Node.js — circuit files are loaded from the package.');
  }

  const circuitsDir = resolve(__dirname, '../circuits');

  const [circuitRaw, provingKeyBuf] = await Promise.all([
    readFile(resolve(circuitsDir, 'tornado.json'), 'utf-8'),
    readFile(resolve(circuitsDir, 'tornadoProvingKey.bin')),
  ]);

  // Buffer.buffer may reference a shared pool — slice to get an owned ArrayBuffer
  const provingKey = provingKeyBuf.buffer.slice(
    provingKeyBuf.byteOffset,
    provingKeyBuf.byteOffset + provingKeyBuf.byteLength,
  ) as ArrayBuffer;

  return { circuitText: circuitRaw, provingKey };
}

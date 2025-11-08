import './global.d.ts';

// Check Node.js version - require 22+ for Promise.withResolvers (used by prool/anvil)
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0] || '0', 10);

if (majorVersion < 22) {
  throw new Error(
    `\n❌ Node.js version ${nodeVersion} is not supported.\n` +
    `   @kohaku-eth/railgun requires Node.js 22.0.0 or higher.\n` +
    `   Please upgrade Node.js: https://nodejs.org/\n` +
    `   Current version: ${nodeVersion}\n`
  );
}

// Configuration
export * from './config';

// Provider abstraction
export * from './provider';

// Indexer functionality
export * from './indexer/base.js';
export * from './indexer/storage.js';

// Account functionality
export * from './account/base.js';
export * from './account/storage.js';

// Key derivation utilities (re-export for convenience)
export * from './railgun/lib/key-derivation';

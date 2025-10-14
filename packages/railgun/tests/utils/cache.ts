import fs from 'fs';
import path from 'path';
import { RailgunLog } from '../../src/account-utils';
import { getAllLogs } from '../../src/account-utils/indexer';
import { RAILGUN_CONFIG_BY_CHAIN_ID } from '../../src/config';
import type { RailgunProvider } from '../../src/provider';
import type { ChainId } from '../../src/account-utils/types';

type PublicCache = {
  logs: RailgunLog[];
  merkleTrees: { tree: string[][]; nullifiers: string[] }[];
  endBlock: number;
  chainId: string;
};

const CACHE_DIR = path.resolve(process.cwd(), 'tests/cache');

/**
 * Get cache file path for a specific chain and fork block
 */
function getCachePath(chainId: ChainId, forkBlock: number): string {
  return path.join(CACHE_DIR, `${chainId}_${forkBlock}.json`);
}

/**
 * Get checkpoint file path for a chain
 */
function getCheckpointPath(chainId: ChainId): string {
  return path.resolve(process.cwd(), `checkpoints/${chainId === '11155111' ? 'sepolia' : 'mainnet'}_public_checkpoint.json`);
}

/**
 * Load or create cache for a specific fork block.
 * This loads all logs up to the fork block, using cached data if available.
 */
export async function loadOrCreateCache(
  provider: RailgunProvider,
  chainId: ChainId,
  forkBlock: number
): Promise<PublicCache> {
  // Ensure cache directory exists
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }

  const cachePath = getCachePath(chainId, forkBlock);

  // Check if cache exists
  if (fs.existsSync(cachePath)) {
    console.log(`Loading cache from ${cachePath}...`);
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as PublicCache;
    console.log(`Loaded ${cache.logs.length} cached logs up to block ${cache.endBlock}`);
    return cache;
  }

  console.log(`No cache found for fork block ${forkBlock}, creating new cache...`);

  // Try to load checkpoint as starting point
  const checkpointPath = getCheckpointPath(chainId);
  let startCache: PublicCache;

  if (fs.existsSync(checkpointPath)) {
    console.log(`Loading checkpoint from ${checkpointPath}...`);
    startCache = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as PublicCache;
  } else {
    // No checkpoint, start from scratch
    const config = RAILGUN_CONFIG_BY_CHAIN_ID[chainId];
    startCache = {
      logs: [],
      merkleTrees: [],
      endBlock: config.GLOBAL_START_BLOCK,
      chainId,
    };
  }

  // Fetch logs from checkpoint to fork block
  const startBlock = startCache.endBlock > 0 ? startCache.endBlock : RAILGUN_CONFIG_BY_CHAIN_ID[chainId].GLOBAL_START_BLOCK;

  console.log(`Fetching logs from block ${startBlock} to ${forkBlock}...`);
  const newLogs = await getAllLogs(provider, chainId, startBlock, forkBlock);
  console.log(`Fetched ${newLogs.length} new logs`);

  // Combine logs (deduplicate by blockNumber + logIndex or similar)
  const allLogs = [...startCache.logs, ...newLogs];

  const cache: PublicCache = {
    logs: allLogs,
    merkleTrees: startCache.merkleTrees,
    endBlock: forkBlock,
    chainId,
  };

  // Save cache for future use
  console.log(`Saving cache to ${cachePath}...`);
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2));
  console.log(`Cache saved with ${cache.logs.length} logs up to block ${forkBlock}`);

  return cache;
}

/**
 * Clear cache for specific fork block
 */
export function clearCache(chainId: ChainId, forkBlock: number): void {
  const cachePath = getCachePath(chainId, forkBlock);
  if (fs.existsSync(cachePath)) {
    fs.unlinkSync(cachePath);
    console.log(`Cache cleared: ${cachePath}`);
  }
}

/**
 * Clear all caches
 */
export function clearAllCaches(): void {
  if (fs.existsSync(CACHE_DIR)) {
    const files = fs.readdirSync(CACHE_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(CACHE_DIR, file));
    }
    console.log(`Cleared ${files.length} cache files`);
  }
}

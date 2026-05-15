import { type ERC20AssetId } from '@kohaku-eth/plugins';
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { getAddress } from 'viem';
import { TCAssetBalance } from "../../src";
import { PublicRootState } from '../../src/state/store';

// Helper to get environment variable with fallback
export function getEnv(key: string, fallback?: string): string {
  if (typeof process.env[key] === 'string' && process.env[key]) {
    return process.env[key] as string;
  } else if (fallback) {
    return fallback;
  }

  throw new Error(`Env var ${key} is required and no fallback was provided`);
}

export type InitialState = Record<string, PublicRootState>;

const PPV1_E2E_STATE_PATH_ENV = 'PPV1_E2E_STATE_PATH';

/**
 * Loads and parses initial state from a file path specified by the
 * PPV1_E2E_STATE_PATH environment variable.
 *
 * @returns Parsed state object ready to be injected into the plugin,
 *          or an empty object if the env var is not set or the file
 *          cannot be loaded/parsed.
 */
export async function loadInitialState(chainId: 1 | 11155111): Promise<InitialState> {
  const default_state = path.resolve(path.join(__dirname, "..", `state.${chainId}.json`));
  const statePath = getEnv(
    PPV1_E2E_STATE_PATH_ENV,
    default_state
  );

  if (!statePath) {
    return {};
  }

  try {
    if (!existsSync(statePath)) {
      console.warn(`[loadInitialState] State file not found: ${statePath}`);

      return {};
    }

    const rawState = await readFile(statePath, 'utf-8');
    const state = JSON.parse(rawState) as InitialState;

    Object.entries(state).forEach(([key, val]) => console.log("Last synced block:", key, Number(val.sync.lastSyncedBlock)));
    console.log(`[loadInitialState] Loaded state file succesfully from ${statePath}`);

    return state;
  } catch (error) {
    console.warn(`[loadInitialState] Failed to load state from ${statePath}:`, error);

    return {};
  }
}

export function ERC20Asset(address: string): ERC20AssetId {
  return {
    contract: getAddress(address),
    __type: 'erc20'
  };
}


export type TCBalancePending = TCAssetBalance & { tag: "pending"; };
export type TCBalanceApproved = Omit<TCAssetBalance, "tag">;

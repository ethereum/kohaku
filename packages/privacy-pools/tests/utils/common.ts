import { type ERC20AssetId } from '@kohaku-eth/plugins';
import { readFileSync, existsSync } from "node:fs";
import { MAINNET_CONFIG, PPv1AssetBalance } from "../../src";
import type { RootState } from "../../src/state/store";
import { getAddress } from 'viem';

// Helper to get environment variable with fallback
export function getEnv(key: string, fallback: string): string {
  if (typeof process.env[key] === 'string' && process.env[key]) {
    return process.env[key] as string;
  }

  return fallback;
}

export type InitialState = Record<string, RootState>;

const PPV1_E2E_STATE_PATH_ENV = 'PPV1_E2E_STATE_PATH';

/**
 * Loads and parses initial state from a file path specified by the
 * PPV1_E2E_STATE_PATH environment variable.
 *
 * @returns Parsed state object ready to be injected into the plugin,
 *          or an empty object if the env var is not set or the file
 *          cannot be loaded/parsed.
 */
export function loadInitialState(): InitialState {
  const statePath = process.env[PPV1_E2E_STATE_PATH_ENV];

  if (!statePath) {
    return {};
  }

  try {
    if (!existsSync(statePath)) {
      console.warn(`[loadInitialState] State file not found: ${statePath}`);

      return {};
    }

    const rawState = readFileSync(statePath, 'utf-8');
    const state = JSON.parse(rawState) as InitialState;

    Object.entries(state).forEach(([key, val]) => console.log("Last synced block:", key, Number(val.sync.lastSyncedBlock)));
    console.log(`[loadInitialState] Loaded state file succesfully from ${statePath}`);

    return state;
  } catch (error) {
    console.warn(`[loadInitialState] Failed to load state from ${statePath}:`, error);

    return {};
  }
}

export const MAINNET_ENTRYPOINT = {
  address: BigInt(MAINNET_CONFIG.ENTRYPOINT_ADDRESS),
  deploymentBlock: 22153713n,
};

export function ERC20Asset(address: string): ERC20AssetId {
  return {
    contract: getAddress(address),
    __type: 'erc20'
  };
}


export type PPv1AssetBalancePending = PPv1AssetBalance & { tag: "pending"; };
export type PPv1AssetBalanceApproved = Omit<PPv1AssetBalance, "tag">;

export function unwrapBalance(
  preDepositBalance: PPv1AssetBalance[],
  nativeAsset: ERC20AssetId
): { pending?: PPv1AssetBalancePending; approved?: PPv1AssetBalanceApproved; } {
  const pending = preDepositBalance.find(b => (b.asset.contract === nativeAsset.contract) && b.tag && b.tag === "pending") as PPv1AssetBalancePending | undefined;
  const approved = preDepositBalance.find(b => (b.asset.contract === nativeAsset.contract) && b.tag === undefined);

  return { pending, approved };
}

import { type Storage } from "@kohaku-eth/plugins";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { type TacitChainConfig } from "../config";
import { utf8 } from "../crypto/bytes";
import { toSaved, type SavedState, type SyncState } from "./absorb";

/** The storage key of one wallet's synced state on one pool. The address is hashed so the key reveals nothing. */
export const stateKey = (config: TacitChainConfig, address: string): string =>
  `tacit-evm-pool-state-v1:${config.chainId}:${config.pool.toLowerCase()}:${bytesToHex(sha256(utf8(address))).slice(0, 16)}`;

/** The synced state in `host.storage`: view-level only, as JSON. Unreadable state is treated as none. */
export class StateStore {
  constructor(
    private readonly storage: Storage,
    private readonly key: string,
  ) {}

  async load(): Promise<SavedState | null> {
    try {
      const text = await this.storage.get(this.key);

      return text ? (JSON.parse(text) as SavedState) : null;
    } catch {
      return null;
    }
  }

  save(state: SyncState): Promise<void> {
    return this.storage.set(this.key, JSON.stringify(toSaved(state)));
  }
}

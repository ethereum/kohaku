import type {
  RailgunIndexerSnapshot,
  RailgunIndexerStorage,
} from './types';
import { deepClone } from '../utils/clone';

export class InMemoryIndexerStorage implements RailgunIndexerStorage {
  private snapshot: RailgunIndexerSnapshot | undefined;

  async load(): Promise<RailgunIndexerSnapshot | undefined> {
    return this.snapshot ? deepClone(this.snapshot) : undefined;
  }

  async save(snapshot: RailgunIndexerSnapshot): Promise<void> {
    this.snapshot = deepClone(snapshot);
  }
}

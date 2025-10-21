import type { ChainId } from '../indexer';
import type { RailgunAccountStorage } from './index';
import type { SerializedNoteData } from '../railgun/logic/logic/note';
import { deepClone } from '../utils/clone';

export class InMemoryAccountStorage implements RailgunAccountStorage {
  private readonly notes = new Map<ChainId, SerializedNoteData[][]>();

  async load(chainId: ChainId): Promise<SerializedNoteData[][] | undefined> {
    const stored = this.notes.get(chainId);

    return stored ? deepClone(stored) : undefined;
  }

  async save(chainId: ChainId, noteBooks: SerializedNoteData[][]): Promise<void> {
    this.notes.set(chainId, deepClone(noteBooks));
  }
}

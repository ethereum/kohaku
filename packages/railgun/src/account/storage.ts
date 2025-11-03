import { Note, SerializedNoteData } from "~/railgun/logic/logic/note";
import { createBaseStorage, StorageLayer } from "~/storage/base";
import { Notebook } from "~/utils/notebook";

import { DerivedKeys } from "./keys";

export type CachedNotebooks = SerializedNoteData[][];

export type AccountStorage = {
  notebooks: Notebook[];
};
export type CachedAccountStorage = {
  notebooks: SerializedNoteData[][];
};

export type AccountStorageContext = Pick<DerivedKeys, "viewing" | "spending">;

export const createAccountStorage = async (
  storage: StorageLayer,
  { spending, viewing }: AccountStorageContext
) => {
  const viewingKey = (await viewing.getViewingKeyPair()).privateKey;
  const spendingKey = spending.getSpendingKeyPair().privateKey;

  const { load, save } = createBaseStorage<
    AccountStorage,
    CachedAccountStorage
  >(storage, {
    parse: async ({ notebooks } = { notebooks: [] }) => {
      const parsed: Notebook[] = [];

      for (let i = 0; i < notebooks.length; i++) {
        if (!parsed[i]) {
          parsed[i] = new Notebook();
        }

        notebooks[i]!.forEach((noteData, j) => {
          if (noteData !== null) {
            parsed[i]!.notes[j] = Note.fromSerializedNoteData(
              spendingKey,
              viewingKey,
              noteData
            );
          }
        });
      }

      return { notebooks: parsed };
    },
    serialize: async ({ notebooks }) => {
      const serialized = [];

      for (const noteBook of notebooks) {
        serialized.push(noteBook ? noteBook.serialize() : []);
      }

      return { notebooks: serialized };
    },
  });

  const { notebooks } = await load();

  const saveNotebooks = () => save({ notebooks });

  return {
    notebooks,
    saveNotebooks,
  };
};

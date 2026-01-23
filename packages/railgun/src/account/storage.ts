import { Note, SerializedNoteData } from "~/railgun/logic/logic/note";
import { createBaseStorage, StorageLayer } from "~/storage/base";
import { createEmptyStorageLayer } from "~/storage/layers/empty";
import { Notebook } from "~/utils/notebook";
import { DerivedKeys } from "./keys";

export type AccountStorage = {
    notebooks: Notebook[];
    endBlock: number;
};
export type CachedAccountStorage = {
    notebooks: SerializedNoteData[][];
    endBlock: number;
};

export type AccountStorageContext = Pick<DerivedKeys, 'viewing' | 'spending'>;

export const parseAccountStorage = async (
    cached: CachedAccountStorage,
    { spending, viewing }: AccountStorageContext
): Promise<AccountStorage> => {
    const viewingKey = (await viewing.getViewingKeyPair()).privateKey;
    const spendingKey = spending.getSpendingKeyPair().privateKey;

    const parsed: Notebook[] = [];

    for (let i = 0; i < cached.notebooks.length; i++) {
        if (!parsed[i]) {
            parsed[i] = new Notebook();
        }

        cached.notebooks[i]!.forEach((noteData, j) => {
            if (noteData !== null) {
                parsed[i]!.notes[j] = Note.fromSerializedNoteData(spendingKey, viewingKey, noteData);
            }
        });
    }

    return {
        notebooks: parsed,
        endBlock: cached.endBlock !== undefined ? cached.endBlock : 0,
    };
};

export const serializeAccountStorage = (storage: AccountStorage): CachedAccountStorage => {
    const serialized = [];

    for (const noteBook of storage.notebooks) {
        serialized.push(noteBook ? noteBook.serialize() : []);
    }

    return {
        notebooks: serialized,
        endBlock: storage.endBlock !== undefined ? storage.endBlock : 0,
    };
};

export const createAccountStorage = async (
    { storage, loadState, spending, viewing }: { storage?: StorageLayer; loadState?: CachedAccountStorage } & AccountStorageContext
) => {
    // Validate: storage and loadState are mutually exclusive
    if (storage !== undefined && loadState !== undefined) {
        throw new Error('Cannot provide both storage and loadState. Use one or the other.');
    }

    const layer = storage || createEmptyStorageLayer();
    const { load, save } = createBaseStorage<AccountStorage, CachedAccountStorage>(layer, {
        parse: async ({ notebooks, endBlock } = { notebooks: [], endBlock: 0 }) => {
            return await parseAccountStorage({ notebooks, endBlock: endBlock ?? 0 }, { spending, viewing });
        },
        serialize: async ({ notebooks, endBlock }) => {
            return serializeAccountStorage({ notebooks, endBlock: endBlock ?? 0 });
        },
    });

    // Load from loadState if provided, otherwise from storage if available
    const accountState = loadState
        ? await parseAccountStorage(loadState, { spending, viewing })
        : await load();

    const saveNotebooks = () => save(accountState);

    return {
        notebooks: accountState.notebooks,
        getEndBlock: () => accountState.endBlock,
        saveNotebooks,
        setEndBlock: (endBlock: number) => {
            accountState.endBlock = endBlock;
        },
    };
}

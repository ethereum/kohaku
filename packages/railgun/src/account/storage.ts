import { SerializedNoteData } from "~/railgun/logic/logic/note";
import { Notebook } from "~/utils/notebook";
import { Note } from '~/railgun/logic/logic/note';
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { DerivedKeys } from "./keys";
import { ByteUtils } from "~/railgun/lib/utils";
import { hexStringToArray } from "~/railgun/logic/global/bytes";

export type CachedNotebooks = SerializedNoteData[][];

// export type AccountStorage = createStorage<CachedNotebooks, Notebook[]>();

export type LoadCachedNotebooksParams = {
  trees: MerkleTree[];
  notebooks: Notebook[];
} & Pick<DerivedKeys, 'viewing' | 'spending'>;

export const loadCachedNotebooks = async (cached: CachedNotebooks, { viewing, spending, trees, notebooks }: LoadCachedNotebooksParams) => {
  const viewingKey = (await viewing.getViewingKeyPair()).privateKey;
  const spendingKey = spending.getSpendingKeyPair().privateKey;

  for (let i = 0; i < cached.length; i++) {
    if (!trees[i]) {
      trees[i] = await MerkleTree.createTree(i);
      notebooks[i] = new Notebook();
    }

    cached[i]!.forEach((noteData, j) => {
      if (noteData !== null) {
        notebooks[i]!.notes[j] = Note.fromSerializedNoteData(spendingKey, viewingKey, noteData);
      }
    });
  }
};


export type CachedMerkleTrees = { tree: string[][], nullifiers: string[] }[];

// export const createIndexerStorage;

export const loadCachedMerkleTrees = async (cachedTrees: CachedMerkleTrees) => {
  const trees: MerkleTree[] = [];

  for (let i = 0; i < cachedTrees.length; i++) {
    const merkleTree = await MerkleTree.createTree(i);

    merkleTree.tree = cachedTrees[i]!.tree.map(level => level.map(hexStringToArray));
    merkleTree.nullifiers = cachedTrees[i]!.nullifiers.map(hexStringToArray);


    if (!trees[i]) {
      trees[i] = merkleTree;
      // TODO: unknown side-effect, notebook creation
      //  this.noteBooks[i] = new NoteBook();
    } else {
      trees[i] = merkleTree;
    }
  }

  return trees;
}

export const serializeMerkleTrees = (trees: MerkleTree[]): CachedMerkleTrees => {
  const merkleTrees = [];

  for (const tree of trees) {
      merkleTrees.push({
          tree: tree.tree.map(level => level.map(leaf => ByteUtils.hexlify(leaf, true))),
          nullifiers: tree.nullifiers.map(nullifier => ByteUtils.hexlify(nullifier, true)),
      });
  }

  return merkleTrees;
};

/*
// Indexer function (realistically at boot if given storage)
    async loadCachedMerkleTrees(merkleTrees: { tree: string[][], nullifiers: string[] }[]) {
        for (let i = 0; i < merkleTrees.length; i++) {
            const merkleTree = await MerkleTree.createTree(i);

            merkleTree.tree = merkleTrees[i]!.tree.map(level => level.map(hexStringToArray));
            merkleTree.nullifiers = merkleTrees[i]!.nullifiers.map(hexStringToArray);

            if (!this.merkleTrees[i]) {
                this.merkleTrees[i] = merkleTree;
                this.noteBooks[i] = new NoteBook();
            } else {
                this.merkleTrees[i] = merkleTree;
            }
        }
    }
    // Indexer storage function
    serializeMerkleTrees() {
        const merkleTrees = [];

        for (const tree of this.merkleTrees) {

            merkleTrees.push({
                tree: tree.tree.map(level => level.map(leaf => ByteUtils.hexlify(leaf, true))),
                nullifiers: tree.nullifiers.map(nullifier => ByteUtils.hexlify(nullifier, true)),
            });
        }

        return merkleTrees;
    }

    */

/*

    // Account function (realistically at boot if given storage)
    async loadCachedNoteBooks(noteBooks: SerializedNoteData[][]) {
        const viewingKey = (await this.viewing.getViewingKeyPair()).privateKey;
        const spendingKey = this.spending.getSpendingKeyPair().privateKey;

        for (let i = 0; i < noteBooks.length; i++) {
            if (!this.merkleTrees[i]) {
                this.merkleTrees[i] = await MerkleTree.createTree(i);
                this.noteBooks[i] = new NoteBook();
            }

            noteBooks[i]!.forEach((noteData, j) => {
                if (noteData !== null) {
                    this.noteBooks[i]!.notes[j] = Note.fromSerializedNoteData(spendingKey, viewingKey, noteData);
                }
            });
        }
    }


    // Account storage function
    serializeNoteBooks() {
        const noteBooks = [];

        for (const noteBook of this.noteBooks) {
            noteBooks.push(noteBook.serialize());
        }

        return noteBooks;
    }
    */

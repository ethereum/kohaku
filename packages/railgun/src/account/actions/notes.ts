import { Address } from "viem";

import { Indexer } from "~/indexer/base";
import { decodeAddress } from "~/railgun/lib/key-derivation";
import { ByteUtils } from "~/railgun/lib/utils";
import { Note, SendNote, UnshieldNote } from "~/railgun/logic/logic/note";
import { getERC20TokenData } from "~/utils/account/token";
import { Notebook } from "~/utils/notebook";

import { DerivedKeys } from "../keys";

export type TransactNotes = {
  notesIn: Note[][];
  notesOut: (Note | UnshieldNote | SendNote)[][];
  nullifiers: Uint8Array[][];
};

export type GetAllNotesFn = (treeIndex: number) => Note[];
export type GetTransactNotesFn = (
  token: Address,
  value: bigint,
  receiver: string,
  getNullifiers?: boolean
) => Promise<TransactNotes>;
export type GetUnspentNotesFn = (token: Address) => Promise<Note[][]>;
export type GetNotes = {
  getAllNotes: GetAllNotesFn;
  getTransactNotes: GetTransactNotesFn;
  getUnspentNotes: GetUnspentNotesFn;
};

export type GetNotesContext = {
  notebooks: Notebook[];
} & Pick<Indexer, "getTrees"> &
  Pick<DerivedKeys, "spending" | "viewing">;

export const makeGetNotes = async ({
  notebooks,
  getTrees,
  spending,
  viewing,
}: GetNotesContext): Promise<GetNotes> => {
  const spendingKey = spending.getSpendingKeyPair().privateKey;
  const viewingKey = (await viewing.getViewingKeyPair()).privateKey;

  const getAllNotes: GetAllNotesFn = (treeIndex: number) => {
    if (!notebooks[treeIndex]) {
      throw new Error("tree index DNE");
    }

    return notebooks[treeIndex].notes;
  };

  const getUnspentNotes: GetUnspentNotesFn = async (token) => {
    const tokenData = getERC20TokenData(token);
    const allNotes: Note[][] = [];

    for (let i = 0; i < getTrees().length; i++) {
      const notes = await notebooks[i]!.getUnspentNotes(
        getTrees()[i]!,
        tokenData
      );

      allNotes.push(notes);
    }

    return allNotes;
  };

  const getTransactNotes: GetTransactNotesFn = async (
    token,
    value,
    receiver,
    getNullifiers = false
  ) => {
    const unspentNotes = await getUnspentNotes(token);
    const isUnshield = receiver.startsWith("0x");

    if (!isUnshield && !receiver.startsWith("0zk")) {
      throw new Error(
        "receiver must be an ethereum 0x address or a railgun 0zk address"
      );
    }

    const notesIn: Note[][] = [];
    const notesOut: (Note | UnshieldNote | SendNote)[][] = [];
    const nullifiers: Uint8Array[][] = [];
    let totalValue = 0n;
    let valueSpent = 0n;

    for (let i = 0; i < unspentNotes.length; i++) {
      const allNotes = notebooks[i]!.notes;
      const treeNotesIn: Note[] = [];
      const treeNullifiers: Uint8Array[] = [];
      let treeValue = 0n;

      for (const note of unspentNotes[i]!) {
        totalValue += note.value;
        treeValue += note.value;
        treeNotesIn.push(note);

        if (getNullifiers) {
          treeNullifiers.push(await note.getNullifier(allNotes.indexOf(note)));
        }

        if (totalValue >= value) {
          break;
        }
      }

      const tokenData = getERC20TokenData(token);

      const treeNotesOut: (Note | UnshieldNote | SendNote)[] = [];

      if (totalValue > value) {
        const changeNote = new Note(
          spendingKey,
          viewingKey,
          totalValue - value,
          ByteUtils.hexStringToBytes(ByteUtils.randomHex(16)),
          tokenData,
          ""
        );

        treeNotesOut.push(changeNote);
      }

      if (treeValue > 0n) {
        const amount =
          treeValue > value - valueSpent ? value - valueSpent : treeValue;

        if (isUnshield) {
          treeNotesOut.push(new UnshieldNote(receiver, amount, tokenData));
        } else {
          const { masterPublicKey, viewingPublicKey } = decodeAddress(receiver);

          treeNotesOut.push(
            new SendNote(
              masterPublicKey,
              viewingPublicKey,
              amount,
              ByteUtils.hexStringToBytes(ByteUtils.randomHex(16)),
              tokenData,
              ""
            )
          );
        }

        valueSpent += amount;
      }

      notesIn.push(treeNotesIn);
      notesOut.push(treeNotesOut);
      nullifiers.push(treeNullifiers);

      if (totalValue >= value) {
        break;
      }
    }

    if (totalValue < value) {
      throw new Error("insufficient value in unspent notes");
    }

    return { notesIn, notesOut, nullifiers };
  };

  return { getAllNotes, getTransactNotes, getUnspentNotes };
};

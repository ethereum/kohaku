import { ByteUtils } from '../railgun/lib/utils/bytes';
import { decodeReceiver } from './shield';
import { getERC20TokenData } from '../utils/account';
import type { MerkleTree } from '../railgun/logic/logic/merkletree';
import { Note, UnshieldNote, SendNote } from '../railgun/logic/logic/note';

export type PreparedNotes = {
  notesIn: Note[][];
  notesOut: (Note | UnshieldNote | SendNote)[][];
  nullifiers: Uint8Array[][];
};

export const prepareTransactionNotes = async (
  merkleTrees: MerkleTree[],
  noteBooks: { notes: Note[] }[],
  unspentNotesByTree: Note[][],
  spendingKey: Uint8Array,
  viewingKey: Uint8Array,
  token: string,
  value: bigint,
  receiver: string,
  getNullifiers: boolean = false,
): Promise<PreparedNotes> => {
  const isUnshield = receiver.startsWith('0x');

  if (!isUnshield && !receiver.startsWith('0zk')) {
    throw new Error('receiver must be an ethereum 0x address or a railgun 0zk address');
  }

  const notesIn: Note[][] = [];
  const notesOut: (Note | UnshieldNote | SendNote)[][] = [];
  const nullifiers: Uint8Array[][] = [];
  let totalValue = 0n;
  let valueSpent = 0n;

  for (let i = 0; i < unspentNotesByTree.length; i++) {
    const treeNotesIn: Note[] = [];
    const treeNullifiers: Uint8Array[] = [];
    let treeValue = 0n;

    for (const note of unspentNotesByTree[i]!) {
      totalValue += note.value;
      treeValue += note.value;
      treeNotesIn.push(note);

      if (getNullifiers) {
        const noteIndex = noteBooks[i]!.notes.indexOf(note);

        if (noteIndex >= 0) {
          treeNullifiers.push(await note.getNullifier(noteIndex));
        }
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
        '',
      );

      treeNotesOut.push(changeNote);
    }

    if (treeValue > 0n) {
      const amount = treeValue > value - valueSpent ? value - valueSpent : treeValue;

      if (isUnshield) {
        treeNotesOut.push(new UnshieldNote(receiver, amount, tokenData));
      } else {
        const { masterPublicKey, viewingPublicKey } = decodeReceiver(receiver);

        treeNotesOut.push(
          new SendNote(
            masterPublicKey,
            viewingPublicKey,
            amount,
            ByteUtils.hexStringToBytes(ByteUtils.randomHex(16)),
            tokenData,
            '',
          ),
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
    throw new Error('insufficient value in unspent notes');
  }

  return { notesIn, notesOut, nullifiers };
};

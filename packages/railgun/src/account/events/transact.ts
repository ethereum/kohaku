import { BigNumberish } from "ethers";

import { TOTAL_LEAVES } from "~/config";
import { Indexer } from "~/indexer/base";
import { hexStringToArray } from "~/railgun/logic/global/bytes";
import { Note } from "~/railgun/logic/logic/note";
import { CommitmentCiphertextStructOutput } from "~/railgun/logic/typechain-types/contracts/logic/RailgunLogic";
import { Notebook } from "~/utils/notebook";

import { DerivedKeys } from "../keys";

export type TransactEvent = {
  treeNumber: BigNumberish;
  startPosition: BigNumberish;
  hash: string[];
  ciphertext: CommitmentCiphertextStructOutput[];
};

export type HandleTransactEventContext = {
  notebooks: Notebook[];
  saveNotebooks: () => Promise<void>;
} & Pick<DerivedKeys, "viewing" | "spending"> &
  Pick<Indexer, "getTrees">;

export type HandleTransactEventFn = (
  event: TransactEvent,
  skipMerkleTree: boolean
) => Promise<void>;
export type HandleTransactEvent = {
  handleTransactEvent: HandleTransactEventFn;
};

export const makeHandleTransactEvent = async ({
  notebooks,
  getTrees,
  viewing,
  spending,
  saveNotebooks,
}: HandleTransactEventContext): Promise<HandleTransactEventFn> => {
  const viewingKey = (await viewing.getViewingKeyPair()).privateKey;
  const spendingKey = spending.getSpendingKeyPair().privateKey;

  return async (event: TransactEvent, skipMerkleTree: boolean) => {
    // Get start position
    const startPosition = Number(event.startPosition.toString());

    // Get tree number
    const treeNumber = Number(event.treeNumber.toString());

    if (!skipMerkleTree) {
      // Check tree boundary
      const isCrossingTreeBoundary =
        startPosition + event.hash.length > TOTAL_LEAVES;

      // Get leaves
      // const leaves = event.hash.map((noteHash) => hexStringToArray(noteHash));

      // Insert leaves
      if (isCrossingTreeBoundary) {
        if (!getTrees()[treeNumber + 1]) {
          // getTrees()[treeNumber + 1] = await MerkleTree.createTree(treeNumber + 1);
          notebooks[treeNumber + 1] = new Notebook();
        }

        // getTrees()[treeNumber + 1]!.insertLeaves(leaves, 0);
      } else {
        if (!getTrees()[treeNumber]) {
          // getTrees()[treeNumber] = await MerkleTree.createTree(treeNumber);
          notebooks[treeNumber] = new Notebook();
        }

        // getTrees()[treeNumber]!.insertLeaves(leaves, startPosition);
      }
    }

    // Loop through each token we're scanning
    await Promise.all(
      // Loop through every note and try to decrypt as token
      event.ciphertext.map(async (ciphertext, index) => {
        // Attempt to decrypt note with token
        const note = await Note.decrypt(
          {
            ciphertext: [
              hexStringToArray(ciphertext.ciphertext[0]),
              hexStringToArray(ciphertext.ciphertext[1]),
              hexStringToArray(ciphertext.ciphertext[2]),
              hexStringToArray(ciphertext.ciphertext[3]),
            ],
            blindedSenderViewingKey: hexStringToArray(
              ciphertext.blindedSenderViewingKey
            ),
            blindedReceiverViewingKey: hexStringToArray(
              ciphertext.blindedReceiverViewingKey
            ),
            annotationData: hexStringToArray(ciphertext.annotationData),
            memo: hexStringToArray(ciphertext.memo),
          },
          viewingKey,
          spendingKey
        );

        // If note was decrypted add to wallet
        if (note) {
          if (startPosition + index >= TOTAL_LEAVES) {
            if (!notebooks[treeNumber + 1]) {
              notebooks[treeNumber + 1] = new Notebook();
            }

            notebooks[treeNumber + 1]!.notes[
              startPosition + index - TOTAL_LEAVES
            ] = note;
          } else {
            if (!notebooks[treeNumber]) {
              notebooks[treeNumber] = new Notebook();
            }

            notebooks[treeNumber]!.notes[startPosition + index] = note;
          }
        }

        saveNotebooks();
      })
    );
  };
};

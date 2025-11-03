import { Indexer } from "~/indexer/base";
import { hexStringToArray } from "~/railgun/logic/global/bytes";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";

export type NullifiedEvent = {
  treeNumber: number;
  nullifier: string[];
};

export type HandleNullifiedEventContext = Pick<Indexer, "getTrees">;

export type HandleNullifiedEventFn = (
  event: NullifiedEvent,
  skipMerkleTree: boolean
) => Promise<void>;

export const makeHandleNullifiedEvent = async ({
  getTrees,
}: HandleNullifiedEventContext): Promise<HandleNullifiedEventFn> => {
  return async (event: NullifiedEvent, skipMerkleTree: boolean) => {
    if (skipMerkleTree) return;

    // Get tree number
    const treeNumber = Number(event.treeNumber.toString());

    // Create new merkleTrees and noteBooks if necessary
    if (!getTrees()[treeNumber]) {
      getTrees()[treeNumber] = await MerkleTree.createTree(treeNumber);
    }

    const nullifiersFormatted = event.nullifier.map((nullifier) =>
      hexStringToArray(nullifier)
    );

    getTrees()[treeNumber]!.nullifiers.push(...nullifiersFormatted);
  };
};

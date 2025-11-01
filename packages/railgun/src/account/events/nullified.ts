import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { Notebook } from "~/utils/notebook";
import { hexStringToArray } from "~/railgun/logic/global/bytes";

export type NullifiedEvent = {
    treeNumber: number;
    nullifier: string[];
};

export type HandleNullifiedEventContext = {
    trees: MerkleTree[];
    notebooks: Notebook[];
};

export type HandleNullifiedEventFn = (event: NullifiedEvent, skipMerkleTree: boolean) => Promise<void>;

export const makeHandleNullifiedEvent = async ({ trees, notebooks }: HandleNullifiedEventContext): Promise<HandleNullifiedEventFn> => {
    return async (event: NullifiedEvent, skipMerkleTree: boolean) => {
        if (skipMerkleTree) return;

         // Get tree number
         const treeNumber = Number(event.treeNumber.toString());

         // Create new merkleTrees and noteBooks if necessary
         if (!trees[treeNumber]) {
             trees[treeNumber] = await MerkleTree.createTree(treeNumber);
             notebooks[treeNumber] = new Notebook();
         }

         const nullifiersFormatted = event.nullifier.map((nullifier) =>
             hexStringToArray(nullifier),
         );

         trees[treeNumber]!.nullifiers.push(...nullifiersFormatted);
    }
}
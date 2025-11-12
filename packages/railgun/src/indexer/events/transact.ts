import { BigNumberish } from "ethers";
import {
    CommitmentCiphertextStructOutput,
} from '~/railgun/logic/typechain-types/contracts/logic/RailgunLogic';
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { TOTAL_LEAVES } from "~/config";
import { hexStringToArray } from "~/railgun/logic/global/bytes";
import { Indexer } from "~/indexer/base";

export type TransactEvent = {
    treeNumber: BigNumberish;
    startPosition: BigNumberish;
    hash: string[];
    ciphertext: CommitmentCiphertextStructOutput[];
};

export type HandleTransactEventContext = Pick<Indexer, 'getTrees'> & Pick<Indexer, 'accounts'>;

export type HandleTransactEventFn = (event: TransactEvent, skipMerkleTree: boolean, blockNumber: number) => Promise<void>;

export const makeHandleTransactEvent = async ({ getTrees, accounts }: HandleTransactEventContext): Promise<HandleTransactEventFn> => {

    return async (event: TransactEvent, skipMerkleTree: boolean, blockNumber: number) => {
        console.log('handleTransactEvent', event);

        // Get start position
        const startPosition = Number(event.startPosition.toString());

        // Get tree number
        const treeNumber = Number(event.treeNumber.toString());

        if (!skipMerkleTree) {
            // Check tree boundary
            const isCrossingTreeBoundary = startPosition + event.hash.length > TOTAL_LEAVES;

            // Get leaves
            const leaves = event.hash.map((noteHash) => hexStringToArray(noteHash));

            // Insert leaves
            if (isCrossingTreeBoundary) {
                if (!getTrees()[treeNumber + 1]) {
                    getTrees()[treeNumber + 1] = await MerkleTree.createTree(treeNumber + 1);
                }

                getTrees()[treeNumber + 1]!.insertLeaves(leaves, 0);
            } else {
                if (!getTrees()[treeNumber]) {
                    getTrees()[treeNumber] = await MerkleTree.createTree(treeNumber);
                }

                getTrees()[treeNumber]!.insertLeaves(leaves, startPosition);
            }
        }

        await Promise.all(accounts.map(async (account) => {
            await account._internal.handleTransactEvent(event, blockNumber);
        }));
    }
}

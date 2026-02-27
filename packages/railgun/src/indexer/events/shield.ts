import { BigNumberish } from "ethers";
import { TOTAL_LEAVES } from "~/config";
import { TokenType } from "~/railgun/lib/models";
import { bigIntToArray, hexStringToArray } from "~/railgun/logic/global/bytes";
import { hash } from "~/railgun/logic/global/crypto";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { getTokenID } from "~/railgun/logic/logic/note";
import {
    ShieldCiphertextStructOutput,
    CommitmentPreimageStructOutput
} from '~/railgun/logic/typechain-types/contracts/logic/RailgunLogic';
import { Indexer } from "~/indexer/base";
import { RailgunAccount } from "~/account/base";

export type ShieldEvent = {
    treeNumber: BigNumberish;
    startPosition: BigNumberish;
    commitments: CommitmentPreimageStructOutput[];
    shieldCiphertext: ShieldCiphertextStructOutput[];
    fees: BigNumberish[];
}

export type HandleShieldEventContext = Pick<Indexer, 'getTrees'> & { accounts: RailgunAccount[] };

export type HandleShieldEventFn = (event: ShieldEvent, skipMerkleTree: boolean, blockNumber: number) => Promise<void>;

export const makeHandleShieldEvent = async ({ getTrees, accounts }: HandleShieldEventContext): Promise<HandleShieldEventFn> => {

    return async (event: ShieldEvent, skipMerkleTree: boolean, blockNumber: number) => {

        // Get start position
        const startPosition = Number(event.startPosition.toString());

        // Get tree number
        const treeNumber = Number(event.treeNumber.toString());

        if (!skipMerkleTree) {
            // Check tree boundary
            const isCrossingTreeBoundary = startPosition + event.commitments.length > TOTAL_LEAVES;

            // Get leaves
            const leaves = await Promise.all(
                event.commitments.map((commitment) =>
                    hash.poseidon([
                        hexStringToArray(commitment.npk),
                        getTokenID({
                            tokenType: Number(commitment.token.tokenType.toString()) as TokenType,
                            tokenAddress: commitment.token.tokenAddress,
                            tokenSubID: BigInt(commitment.token.tokenSubID),
                        }),
                        bigIntToArray(BigInt(commitment.value), 32),
                    ]),
                ),
            );

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
            await account._internal.handleShieldEvent(event, blockNumber);
        }));
    }
}

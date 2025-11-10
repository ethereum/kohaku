import { BigNumberish } from "ethers";
import { TOTAL_LEAVES } from "~/config";
import { TokenType } from "~/railgun/lib/models";
import { hexStringToArray } from "~/railgun/logic/global/bytes";
import { Note } from "~/railgun/logic/logic/note";
import {
    ShieldCiphertextStructOutput,
    CommitmentPreimageStructOutput
} from '~/railgun/logic/typechain-types/contracts/logic/RailgunLogic';
import { Notebook } from "~/utils/notebook";
import { DerivedKeys } from "../keys";
import { Indexer } from "~/indexer/base";

export type ShieldEvent = {
    treeNumber: BigNumberish;
    startPosition: BigNumberish;
    commitments: CommitmentPreimageStructOutput[];
    shieldCiphertext: ShieldCiphertextStructOutput[];
    fees: BigNumberish[];
}

export type HandleShieldEventContext = {
    notebooks: Notebook[];
    saveNotebooks: () => Promise<void>;
    getAccountEndBlock: () => number;
    setAccountEndBlock: (endBlock: number) => void;
} & Pick<DerivedKeys, 'viewing' | 'spending'> & Pick<Indexer, 'getTrees'>;

export type HandleShieldEventFn = (event: ShieldEvent, blockNumber: number) => Promise<void>;
export type HandleShieldEvent = { handleShieldEvent: HandleShieldEventFn };

export const makeHandleShieldEvent = async ({ notebooks, viewing, spending, saveNotebooks, getAccountEndBlock, setAccountEndBlock }: HandleShieldEventContext): Promise<HandleShieldEventFn> => {
    const viewingKey = (await viewing.getViewingKeyPair()).privateKey;
    const spendingKey = spending.getSpendingKeyPair().privateKey;

    return async (event: ShieldEvent, blockNumber: number) => {
        // Get start position
        const startPosition = Number(event.startPosition.toString());

        // Get tree number
        const treeNumber = Number(event.treeNumber.toString());

        await Promise.all(
            event.shieldCiphertext.map(async (shieldCiphertext, index) => {
                // Try to decrypt
                const decrypted = await Note.decryptShield(
                    hexStringToArray(shieldCiphertext.shieldKey),
                    shieldCiphertext.encryptedBundle.map(hexStringToArray) as [
                        Uint8Array,
                        Uint8Array,
                        Uint8Array,
                    ],
                    {
                        tokenType: Number(event.commitments[index]!.token.tokenType.toString()) as TokenType,
                        tokenAddress: event.commitments[index]!.token.tokenAddress,
                        tokenSubID: BigInt(event.commitments[index]!.token.tokenSubID),
                    },
                    BigInt(event.commitments[index]!.value),
                    viewingKey,
                    spendingKey,
                );

                // Insert into note array in same index as merkle tree
                if (decrypted) {
                    if (startPosition + index >= TOTAL_LEAVES) {
                        if (!notebooks[treeNumber + 1]) {
                            notebooks[treeNumber + 1] = new Notebook();
                        }

                        notebooks[treeNumber + 1]!.notes[startPosition + index - TOTAL_LEAVES] = decrypted;
                    } else {
                        if (!notebooks[treeNumber]) {
                            notebooks[treeNumber] = new Notebook();
                        }

                        notebooks[treeNumber]!.notes[startPosition + index] = decrypted;
                    }

                    await saveNotebooks();
                }
            })
        );

        // Update account endBlock to the maximum of current endBlock and this event's block number
        // This ensures we track the highest block processed, even if events are processed out of order
        const currentEndBlock = getAccountEndBlock();

        setAccountEndBlock(Math.max(currentEndBlock, blockNumber));
    }
}

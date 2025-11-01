import { BigNumberish } from "ethers";
import { TOTAL_LEAVES } from "~/config";
import { TokenType } from "~/railgun/lib/models";
import { bigIntToArray, hexStringToArray } from "~/railgun/logic/global/bytes";
import { hash } from "~/railgun/logic/global/crypto";
import { MerkleTree } from "~/railgun/logic/logic/merkletree";
import { getTokenID, Note } from "~/railgun/logic/logic/note";
import {
    ShieldCiphertextStructOutput,
    CommitmentPreimageStructOutput
} from '~/railgun/logic/typechain-types/contracts/logic/RailgunLogic';
import { Notebook } from "~/utils/notebook";
import { DerivedKeys } from "../keys";

export type ShieldEvent = {
    treeNumber: BigNumberish;
    startPosition: BigNumberish;
    commitments: CommitmentPreimageStructOutput[];
    shieldCiphertext: ShieldCiphertextStructOutput[];
    fees: BigNumberish[];
}

export type HandleShieldEventContext = {
    trees: MerkleTree[];
    notebooks: Notebook[];
} & Pick<DerivedKeys, 'viewing' | 'spending'>;

export type HandleShieldEventFn = (event: ShieldEvent, skipMerkleTree: boolean) => Promise<void>;

export const makeHandleShieldEvent = async ({ trees, notebooks, viewing, spending }: HandleShieldEventContext): Promise<HandleShieldEventFn> => {
    const viewingKey = (await viewing.getViewingKeyPair()).privateKey;
    const spendingKey = spending.getSpendingKeyPair().privateKey;

    return async (event: ShieldEvent, skipMerkleTree: boolean) => {

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
              if (!trees[treeNumber + 1]) {
                  trees[treeNumber + 1] = await MerkleTree.createTree(treeNumber + 1);
                  notebooks[treeNumber + 1] = new Notebook();
              }

                  trees[treeNumber + 1]!.insertLeaves(leaves, 0);
          } else {
              if (!trees[treeNumber]) {
                  trees[treeNumber] = await MerkleTree.createTree(treeNumber);
                  notebooks[treeNumber] = new Notebook();
              }

                  trees[treeNumber]!.insertLeaves(leaves, startPosition);
          }
      }

      event.shieldCiphertext.map((shieldCiphertext, index) => {
          // Try to decrypt
          const decrypted = Note.decryptShield(
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
                  notebooks[treeNumber + 1]!.notes[startPosition + index - TOTAL_LEAVES] = decrypted;
              } else {
                  notebooks[treeNumber]!.notes[startPosition + index] = decrypted;
              }
          }
      });
    }
}

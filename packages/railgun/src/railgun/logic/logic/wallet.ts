import { arrayToHexString } from '../global/bytes';
import { MerkleTree } from './merkletree';
import { getTokenID, Note, TokenData } from './note';


class Wallet {

  notes: Note[] = [];

  constructor() {}

  /**
   * Gets total balance in wallet
   *
   * @returns total balance
   */
  get totalBalance(): bigint {
    return this.notes
      .map((note) => note.value)
      .reduce((accumulator, noteValue) => accumulator + noteValue);
  }

  /**
   * Get unspent notes
   *
   * @param merkletree - merkle tree to use as seen nullifiers source
   * @param token - token to get unspent notes for
   * @returns unspent notes
   */
  async getUnspentNotes(merkletree: MerkleTree, token: TokenData): Promise<Note[]> {
    // Get requested token ID as hex
    const tokenID = arrayToHexString(getTokenID(token), false);

    // Get note nullifiers as hex
    const noteNullifiers = await Promise.all(
      this.notes.map(async (note, index) =>
        arrayToHexString(await note.getNullifier(index), false),
      ),
    );

    // Get note token IDs as hex
    const noteTokenIDs = this.notes.map((note) => arrayToHexString(note.getTokenID(), false));

    // Get seen nullifiers as hex
    const seenNullifiers = merkletree.nullifiers.map((nullifier) =>
      arrayToHexString(nullifier, false),
    );

    // Return notes that haven't had their nullifiers seen and token IDs match
    return this.notes.filter(
      (note, index) =>
        // @ts-expect-error noteNullifiers is defined
        !seenNullifiers.includes(noteNullifiers[index]) && noteTokenIDs[index] === tokenID,
    );
  }

  /**
   * Get balance for token
   *
   * @param merkletree - merkle tree to use as seen nullifiers source
   * @param token - token to get balance of
   * @returns balance
   */
  async getBalance(merkletree: MerkleTree, token: TokenData): Promise<bigint> {
    // Get unspent notes
    const unspentNotes = await this.getUnspentNotes(merkletree, token);

    // Map reduce sum values, default to 0 in no notes
    return unspentNotes.map((note) => note.value).reduce((left, right) => left + right, 0n);
  }

  serialize() {
    return this.notes.map(note => note.serializeNoteData());
  }
}

export { Wallet };

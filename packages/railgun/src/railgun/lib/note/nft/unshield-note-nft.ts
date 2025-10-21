import { NFTTokenData } from '../../models';
import { ERC721_NOTE_VALUE } from '../note-util';
import { UnshieldNote } from '../unshield-note';

export class UnshieldNoteNFT extends UnshieldNote {
  constructor(toAddress: string, tokenData: NFTTokenData, allowOverride: boolean = false) {
    super(toAddress, ERC721_NOTE_VALUE, tokenData, allowOverride);
  }
}

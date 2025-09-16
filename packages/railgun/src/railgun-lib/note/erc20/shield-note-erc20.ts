import { getTokenDataERC20 } from '../note-util';
import { ShieldNote } from '../shield-note';

export class ShieldNoteERC20 extends ShieldNote {
  constructor(masterPublicKey: bigint, random: string, value: bigint, tokenAddress: string) {
    const tokenData = getTokenDataERC20(tokenAddress);
    super(masterPublicKey, random, value, tokenData);
  }
}

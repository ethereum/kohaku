import { ZERO_ADDRESS } from '../../utils/constants';
import { getTokenDataERC20 } from '../note-util';
import { UnshieldNote } from '../unshield-note';

export class UnshieldNoteERC20 extends UnshieldNote {
  constructor(
    toAddress: string,
    value: bigint,
    tokenAddress: string,
    allowOverride: boolean = false,
  ) {
    const tokenData = getTokenDataERC20(tokenAddress);
    super(toAddress, value, tokenData, allowOverride);
  }

  static empty(): UnshieldNote {
    const toAddress = ZERO_ADDRESS;
    const value = BigInt(0);
    const tokenAddress = ZERO_ADDRESS;
    const allowOverride = false;
    return new UnshieldNoteERC20(toAddress, value, tokenAddress, allowOverride);
  }
}
